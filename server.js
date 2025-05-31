
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit');

// Set FFmpeg path
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = process.env.PORT || 5000;

// Trust proxy for Replit environment
app.set('trust proxy', 1);

// Enhanced CORS configuration
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Rate limiting with trust proxy
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(15 * 60 * 1000 / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
});

app.use('/api', limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Ensure directories exist
const videosDir = path.join(__dirname, 'videos');
const processedDir = path.join(videosDir, 'processed');
const tempDir = path.join(videosDir, 'temp');

[videosDir, processedDir, tempDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Clean up old files (older than 1 hour)
function cleanupOldFiles() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    [processedDir, tempDir].forEach(dir => {
        fs.readdir(dir, (err, files) => {
            if (err) return;
            
            files.forEach(file => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;
                    
                    if (now - stats.mtime.getTime() > oneHour) {
                        fs.unlink(filePath, (err) => {
                            if (!err) console.log(`Cleaned up old file: ${file}`);
                        });
                    }
                });
            });
        });
    });
}

// Run cleanup every 30 minutes
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// Enhanced YouTube URL validation
function isValidYouTubeUrl(url) {
    try {
        if (!url || typeof url !== 'string') return false;
        
        // Clean the URL
        url = url.trim();
        
        // Check basic YouTube URL patterns
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\//,
            /^https?:\/\/(www\.)?youtube\.com\/v\//
        ];
        
        const matchesPattern = patterns.some(pattern => pattern.test(url));
        if (!matchesPattern) return false;
        
        // Use ytdl validation as secondary check
        return ytdl.validateURL(url);
    } catch (error) {
        console.error('URL validation error:', error.message);
        return false;
    }
}

// Extract video ID with better error handling
function extractVideoId(url) {
    try {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^#&?]*)/,
            /^([a-zA-Z0-9_-]{11})$/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1] && match[1].length === 11) {
                return match[1];
            }
        }
        return null;
    } catch (error) {
        console.error('Video ID extraction error:', error.message);
        return null;
    }
}

// Enhanced video info retrieval
async function getVideoInfo(videoId) {
    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Add timeout for the request
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const info = await ytdl.getInfo(url);
        clearTimeout(timeout);
        
        if (!info || !info.videoDetails) {
            throw new Error('Invalid video information received');
        }
        
        const duration = parseInt(info.videoDetails.lengthSeconds) || 0;
        
        // Check duration limits
        if (duration > 1800) { // 30 minutes
            throw new Error('Video is too long. Maximum duration is 30 minutes.');
        }
        
        if (duration < 10) { // Minimum 10 seconds
            throw new Error('Video is too short. Minimum duration is 10 seconds.');
        }
        
        return {
            title: info.videoDetails.title || 'Unknown Title',
            duration: duration,
            description: info.videoDetails.description || '',
            thumbnails: info.videoDetails.thumbnails || [],
            viewCount: info.videoDetails.viewCount || '0',
            author: info.videoDetails.author?.name || 'Unknown Author'
        };
    } catch (error) {
        if (error.message.includes('Video unavailable')) {
            throw new Error('Video is unavailable, private, or deleted');
        } else if (error.message.includes('too long') || error.message.includes('too short')) {
            throw error;
        } else {
            console.error('Video info error:', error.message);
            throw new Error('Failed to get video information. Please check the URL and try again.');
        }
    }
}

// Enhanced video download with better error handling
async function downloadVideo(videoId) {
    return new Promise((resolve, reject) => {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const outputPath = path.join(tempDir, `${videoId}_original.mp4`);
        
        // Check if file already exists and is valid
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) {
                console.log('Using cached video:', outputPath);
                return resolve(outputPath);
            } else {
                // Remove empty file
                fs.unlinkSync(outputPath);
            }
        }

        let downloadTimeout;
        let stream;
        let writeStream;

        try {
            console.log('Starting download for video:', videoId);
            
            // Set download timeout (5 minutes)
            downloadTimeout = setTimeout(() => {
                if (stream) stream.destroy();
                if (writeStream) writeStream.destroy();
                // Clean up partial file
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                reject(new Error('Download timeout - video may be too large or network is slow'));
            }, 5 * 60 * 1000);

            stream = ytdl(url, { 
                quality: 'highest',
                filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio
            });

            writeStream = fs.createWriteStream(outputPath);
            
            stream.pipe(writeStream);
            
            stream.on('error', (error) => {
                clearTimeout(downloadTimeout);
                console.error('Download stream error:', error);
                
                // Clean up partial file
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                
                if (error.message.includes('Video unavailable')) {
                    reject(new Error('Video is unavailable, private, or age-restricted'));
                } else {
                    reject(new Error('Failed to download video. Please try a different video.'));
                }
            });
            
            writeStream.on('finish', () => {
                clearTimeout(downloadTimeout);
                console.log('Download completed:', outputPath);
                
                // Verify file size
                const stats = fs.statSync(outputPath);
                if (stats.size < 1000) { // Less than 1KB indicates a problem
                    fs.unlinkSync(outputPath);
                    reject(new Error('Downloaded file is corrupted or empty'));
                } else {
                    resolve(outputPath);
                }
            });
            
            writeStream.on('error', (error) => {
                clearTimeout(downloadTimeout);
                console.error('Write stream error:', error);
                
                // Clean up partial file
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                
                reject(new Error('Failed to save video file'));
            });
            
            // Track download progress
            let downloadedSize = 0;
            stream.on('data', (chunk) => {
                downloadedSize += chunk.length;
            });
            
        } catch (error) {
            clearTimeout(downloadTimeout);
            console.error('Download setup error:', error);
            reject(new Error('Failed to initialize video download'));
        }
    });
}

// Create viral clip from video
async function createViralClip(inputPath, videoId) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(processedDir, `viral_${videoId}_${Date.now()}.mp4`);
        
        // Get video duration first
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                return reject(new Error('Failed to analyze video'));
            }
            
            const duration = metadata.format.duration;
            const clipDuration = Math.min(60, duration); // Max 60 seconds
            const startTime = Math.max(0, Math.random() * (duration - clipDuration));
            
            ffmpeg(inputPath)
                .setStartTime(startTime)
                .setDuration(clipDuration)
                .videoCodec('libx264')
                .audioCodec('aac')
                .size('1080x1920') // Vertical format for social media
                .aspectRatio('9:16')
                .outputOptions([
                    '-preset fast',
                    '-crf 23',
                    '-movflags +faststart'
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log(`Viral clip created: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (error) => {
                    console.error('FFmpeg error:', error);
                    reject(new Error('Failed to process video'));
                })
                .run();
        });
    });
}

// Enhanced API route for video processing
app.post('/api/process', async (req, res) => {
    let downloadedPath = null;
    
    try {
        // Extract video ID from URL or use direct ID
        let videoId = req.body.videoId;
        const { url } = req.body;
        
        if (url && !videoId) {
            videoId = extractVideoId(url);
        }
        
        if (!videoId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Valid YouTube URL or video ID is required' 
            });
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (!isValidYouTubeUrl(videoUrl)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid YouTube URL. Please check the URL and try again.' 
            });
        }

        console.log('Processing video:', videoId);

        // Get video info first
        const videoInfo = await getVideoInfo(videoId);
        console.log('Video info retrieved:', videoInfo.title);

        // Download video
        downloadedPath = await downloadVideo(videoId);
        console.log('Video downloaded:', downloadedPath);
        
        // Create viral clip
        const viralClipPath = await createViralClip(downloadedPath, videoId);
        console.log('Viral clip created:', viralClipPath);
        
        const clipId = path.basename(viralClipPath, '.mp4');
        
        res.json({
            success: true,
            videoId: clipId,
            url: `/api/videos/${clipId}`,
            originalTitle: videoInfo.title,
            originalAuthor: videoInfo.author,
            duration: videoInfo.duration,
            message: 'Viral clip created successfully!'
        });

    } catch (error) {
        console.error('Processing error:', error);
        
        // Clean up downloaded file on error
        if (downloadedPath && fs.existsSync(downloadedPath)) {
            try {
                fs.unlinkSync(downloadedPath);
                console.log('Cleaned up partial download');
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        }
        
        // Return appropriate error message
        let errorMessage = 'Failed to process video';
        let statusCode = 500;
        
        if (error.message.includes('unavailable') || error.message.includes('private')) {
            statusCode = 400;
            errorMessage = error.message;
        } else if (error.message.includes('too long') || error.message.includes('too short')) {
            statusCode = 400;
            errorMessage = error.message;
        } else if (error.message.includes('timeout')) {
            statusCode = 408;
            errorMessage = 'Processing timeout. Please try a shorter video.';
        } else if (error.message.includes('network') || error.message.includes('download')) {
            statusCode = 503;
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        res.status(statusCode).json({ 
            success: false, 
            error: errorMessage
        });
    }
});

// Route for serving videos
app.get('/api/videos/:id', (req, res) => {
    const { id } = req.params;
    const videoPath = path.join(processedDir, `${id}.mp4`);
    
    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({
            error: 'Video not found'
        });
    }
    
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const file = fs.createReadStream(videoPath, { start, end });
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunksize,
        });
        
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
        });
        fs.createReadStream(videoPath).pipe(res);
    }
});

// Route for sample video
app.get('/api/videos/sample', (req, res) => {
    // Create a simple sample video using FFmpeg
    const samplePath = path.join(processedDir, 'sample.mp4');
    
    if (fs.existsSync(samplePath)) {
        const stat = fs.statSync(samplePath);
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': 'video/mp4',
        });
        return fs.createReadStream(samplePath).pipe(res);
    }
    
    // Generate sample video
    ffmpeg()
        .input('color=c=blue:size=1080x1920:duration=10')
        .inputFormat('lavfi')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
            '-preset fast',
            '-crf 23',
            '-movflags +faststart'
        ])
        .output(samplePath)
        .on('end', () => {
            const stat = fs.statSync(samplePath);
            res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': 'video/mp4',
            });
            fs.createReadStream(samplePath).pipe(res);
        })
        .on('error', (error) => {
            res.status(500).json({ error: 'Failed to generate sample video' });
        })
        .run();
});

// Enhanced video info route
app.get('/api/info/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        
        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({ 
                error: 'Invalid video ID format' 
            });
        }
        
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ 
                error: 'Invalid YouTube video ID' 
            });
        }
        
        const info = await getVideoInfo(videoId);
        res.json({
            success: true,
            ...info
        });
        
    } catch (error) {
        console.error('Video info error:', error);
        
        let errorMessage = 'Failed to get video information';
        let statusCode = 500;
        
        if (error.message.includes('unavailable') || error.message.includes('private')) {
            statusCode = 404;
            errorMessage = error.message;
        } else if (error.message.includes('too long') || error.message.includes('too short')) {
            statusCode = 400;
            errorMessage = error.message;
        }
        
        res.status(statusCode).json({ 
            success: false,
            error: errorMessage 
        });
    }
});

// Add endpoint to validate YouTube URL
app.post('/api/validate', (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }
        
        const videoId = extractVideoId(url);
        const isValid = isValidYouTubeUrl(url);
        
        res.json({
            success: true,
            isValid,
            videoId: isValid ? videoId : null
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Validation failed'
        });
    }
});

// Homepage route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'Server is running properly',
        timestamp: new Date().toISOString(),
        port: port,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        path: req.path 
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    cleanupOldFiles();
    process.exit(0);
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Viral Clip Generator Server running on port ${port}`);
    console.log(`📱 Access the site at: http://0.0.0.0:${port}`);
    console.log(`❤️ Health check: http://0.0.0.0:${port}/health`);
    
    // Initial cleanup
    cleanupOldFiles();
});
