
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
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

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

// Rate limiting with proper trust proxy
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // increased limit for development
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(15 * 60 * 1000 / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
    skip: (req) => {
        // Skip rate limiting for health checks and static files
        return req.path === '/health' || req.path.startsWith('/api/videos/');
    }
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
            if (stats.size > 10000) { // At least 10KB for a valid video
                console.log('Using cached video:', outputPath);
                return resolve(outputPath);
            } else {
                // Remove invalid file
                try {
                    fs.unlinkSync(outputPath);
                } catch (e) {
                    console.warn('Could not remove invalid cached file:', e.message);
                }
            }
        }

        let downloadTimeout;
        let stream;
        let writeStream;
        let totalSize = 0;

        try {
            console.log('Starting download for video:', videoId);
            
            // Set download timeout (3 minutes for better user experience)
            downloadTimeout = setTimeout(() => {
                if (stream) stream.destroy();
                if (writeStream) writeStream.destroy();
                cleanupFile(outputPath);
                reject(new Error('Download timeout - please try a shorter video'));
            }, 3 * 60 * 1000);

            // Get video info first to check format availability
            ytdl.getInfo(url).then(info => {
                // Find the best format with both video and audio
                const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
                if (formats.length === 0) {
                    clearTimeout(downloadTimeout);
                    reject(new Error('No suitable video format found'));
                    return;
                }

                stream = ytdl(url, { 
                    quality: 'highestvideo',
                    filter: 'videoandaudio',
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    }
                });

                writeStream = fs.createWriteStream(outputPath);
                
                stream.pipe(writeStream);
                
                stream.on('response', (res) => {
                    totalSize = parseInt(res.headers['content-length']) || 0;
                    console.log(`Download started, expected size: ${Math.round(totalSize / 1024 / 1024)}MB`);
                });
                
                stream.on('error', (error) => {
                    clearTimeout(downloadTimeout);
                    console.error('Download stream error:', error);
                    cleanupFile(outputPath);
                    
                    if (error.message.includes('Video unavailable') || error.message.includes('private')) {
                        reject(new Error('Video is unavailable, private, or age-restricted'));
                    } else if (error.message.includes('Sign in to confirm')) {
                        reject(new Error('Age-restricted video - cannot download'));
                    } else {
                        reject(new Error('Failed to download video. Please try a different video.'));
                    }
                });
                
                writeStream.on('finish', () => {
                    clearTimeout(downloadTimeout);
                    console.log('Download completed:', outputPath);
                    
                    // Verify file size
                    const stats = fs.statSync(outputPath);
                    if (stats.size < 10000) { // Less than 10KB indicates a problem
                        cleanupFile(outputPath);
                        reject(new Error('Downloaded file is too small or corrupted'));
                    } else {
                        console.log(`Successfully downloaded: ${Math.round(stats.size / 1024 / 1024)}MB`);
                        resolve(outputPath);
                    }
                });
                
                writeStream.on('error', (error) => {
                    clearTimeout(downloadTimeout);
                    console.error('Write stream error:', error);
                    cleanupFile(outputPath);
                    reject(new Error('Failed to save video file'));
                });
                
                // Track download progress
                let downloadedSize = 0;
                stream.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        if (progress % 10 === 0) {
                            console.log(`Download progress: ${progress}%`);
                        }
                    }
                });
                
            }).catch(error => {
                clearTimeout(downloadTimeout);
                console.error('Video info error:', error);
                reject(new Error('Failed to get video information'));
            });
            
        } catch (error) {
            clearTimeout(downloadTimeout);
            console.error('Download setup error:', error);
            reject(new Error('Failed to initialize video download'));
        }
    });
}

// Helper function to safely clean up files
function cleanupFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Cleaned up file:', filePath);
        }
    } catch (error) {
        console.warn('Could not clean up file:', filePath, error.message);
    }
}

// Create viral clip from video
async function createViralClip(inputPath, videoId) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(processedDir, `viral_${videoId}_${Date.now()}.mp4`);
        
        console.log('Starting viral clip creation for:', videoId);
        
        // Get video metadata first
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err);
                return reject(new Error('Failed to analyze video'));
            }
            
            const duration = metadata.format.duration;
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            
            if (!videoStream) {
                return reject(new Error('No video stream found'));
            }
            
            // Calculate optimal clip settings
            const maxClipDuration = Math.min(45, duration * 0.8); // Max 45 seconds or 80% of original
            const minClipDuration = Math.min(10, duration); // Min 10 seconds
            const clipDuration = Math.max(minClipDuration, Math.min(maxClipDuration, 30)); // Default to 30 seconds
            
            // Choose the most engaging part (middle portion usually has good content)
            const startTime = Math.max(0, (duration - clipDuration) / 3);
            
            console.log(`Processing clip: ${clipDuration}s from ${Math.round(startTime)}s of ${Math.round(duration)}s video`);
            
            const command = ffmpeg(inputPath)
                .setStartTime(startTime)
                .setDuration(clipDuration)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    // Video settings optimized for social media
                    '-preset', 'fast',
                    '-crf', '23',
                    '-maxrate', '8M',
                    '-bufsize', '16M',
                    '-movflags', '+faststart',
                    // Audio settings
                    '-ac', '2', // Stereo audio
                    '-ar', '48000', // 48kHz sample rate
                    '-b:a', '128k', // 128kbps audio bitrate
                    // Format for vertical video (9:16 aspect ratio)
                    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p',
                    '-aspect', '9:16'
                ])
                .output(outputPath);
            
            let lastProgress = 0;
            
            command
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    const percent = Math.round(progress.percent || 0);
                    if (percent > lastProgress + 10) {
                        console.log(`Clip processing progress: ${percent}%`);
                        lastProgress = percent;
                    }
                })
                .on('end', () => {
                    console.log(`Viral clip created successfully: ${outputPath}`);
                    
                    // Verify the output file
                    if (fs.existsSync(outputPath)) {
                        const stats = fs.statSync(outputPath);
                        if (stats.size > 50000) { // At least 50KB
                            console.log(`Output file size: ${Math.round(stats.size / 1024 / 1024)}MB`);
                            resolve(outputPath);
                        } else {
                            cleanupFile(outputPath);
                            reject(new Error('Generated clip file is too small'));
                        }
                    } else {
                        reject(new Error('Output file was not created'));
                    }
                })
                .on('error', (error) => {
                    console.error('FFmpeg processing error:', error);
                    cleanupFile(outputPath);
                    
                    if (error.message.includes('Invalid data found')) {
                        reject(new Error('Invalid video data - please try a different video'));
                    } else if (error.message.includes('No such file')) {
                        reject(new Error('Input video file not found'));
                    } else {
                        reject(new Error('Failed to process video - please try again'));
                    }
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
    let videoPath;
    
    // Handle special case for sample video
    if (id === 'sample') {
        videoPath = path.join(processedDir, 'sample.mp4');
    } else {
        videoPath = path.join(processedDir, `${id}.mp4`);
    }
    
    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({
            error: 'Video not found',
            id: id,
            path: videoPath
        });
    }
    
    try {
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        // Set headers for video streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        if (range) {
            // Handle range requests for video streaming
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            
            if (start >= fileSize || end >= fileSize) {
                return res.status(416).json({ error: 'Range not satisfiable' });
            }
            
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(videoPath, { start, end });
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunksize,
            });
            
            file.pipe(res);
            
            file.on('error', (error) => {
                console.error('Range stream error:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to stream video' });
                }
            });
            
        } else {
            // Serve entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
            });
            
            const readStream = fs.createReadStream(videoPath);
            readStream.pipe(res);
            
            readStream.on('error', (error) => {
                console.error('Video stream error:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to stream video' });
                }
            });
        }
        
    } catch (error) {
        console.error('Video serving error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route for sample video
app.get('/api/videos/sample', async (req, res) => {
    const samplePath = path.join(processedDir, 'sample.mp4');
    
    try {
        // Check if sample already exists and is valid
        if (fs.existsSync(samplePath)) {
            const stats = fs.statSync(samplePath);
            if (stats.size > 1000) { // File is not empty
                console.log('Serving existing sample video');
                return serveVideoFile(res, samplePath);
            } else {
                // Remove corrupted file
                fs.unlinkSync(samplePath);
            }
        }
        
        console.log('Generating new sample video...');
        
        // Create a sample video with text overlay and effects
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input('color=c=#ff0040:size=1080x1920:duration=15:rate=30')
                .inputFormat('lavfi')
                .input('anullsrc=channel_layout=stereo:sample_rate=48000')
                .inputFormat('lavfi')
                .videoCodec('libx264')
                .audioCodec('aac')
                .complexFilter([
                    // Create animated background
                    '[0:v]scale=1080:1920,format=yuv420p[bg]',
                    // Add text overlay with animation
                    '[bg]drawtext=fontsize=80:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-200:text=\'🔥 VIRAL CLIP 🔥\':enable=\'between(t,1,14)\'[text1]',
                    '[text1]drawtext=fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:text=\'Sample Video\':enable=\'between(t,2,14)\'[text2]',
                    '[text2]drawtext=fontsize=40:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+200:text=\'Ready for Social Media\':enable=\'between(t,3,14)\'[final]'
                ])
                .outputOptions([
                    '-map', '[final]',
                    '-map', '1:a',
                    '-preset', 'fast',
                    '-crf', '23',
                    '-movflags', '+faststart',
                    '-t', '15',
                    '-r', '30'
                ])
                .output(samplePath)
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('Sample video progress:', Math.round(progress.percent || 0) + '%');
                })
                .on('end', () => {
                    console.log('Sample video generation completed');
                    resolve();
                })
                .on('error', (error) => {
                    console.error('Sample video generation error:', error);
                    reject(error);
                })
                .run();
        });
        
        // Verify the generated file
        if (fs.existsSync(samplePath)) {
            const stats = fs.statSync(samplePath);
            if (stats.size > 1000) {
                console.log(`Sample video generated successfully: ${stats.size} bytes`);
                return serveVideoFile(res, samplePath);
            }
        }
        
        throw new Error('Generated sample video is invalid');
        
    } catch (error) {
        console.error('Sample video error:', error);
        res.status(500).json({ 
            error: 'Failed to generate sample video',
            details: error.message 
        });
    }
});

// Helper function to serve video files with proper headers
function serveVideoFile(res, filePath) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    
    res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
    });
    
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
    
    readStream.on('error', (error) => {
        console.error('Error streaming video:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream video' });
        }
    });
}

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
