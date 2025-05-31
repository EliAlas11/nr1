
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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    try {
        return ytdl.validateURL(url);
    } catch (error) {
        return false;
    }
}

// Get video info
async function getVideoInfo(videoId) {
    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const info = await ytdl.getInfo(url);
        return {
            title: info.videoDetails.title,
            duration: parseInt(info.videoDetails.lengthSeconds),
            description: info.videoDetails.description,
            thumbnails: info.videoDetails.thumbnails
        };
    } catch (error) {
        throw new Error('Failed to get video information');
    }
}

// Download YouTube video
async function downloadVideo(videoId) {
    return new Promise((resolve, reject) => {
        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            const outputPath = path.join(tempDir, `${videoId}_original.mp4`);
            
            if (fs.existsSync(outputPath)) {
                return resolve(outputPath);
            }

            const stream = ytdl(url, { 
                quality: 'highestvideo',
                filter: format => format.container === 'mp4'
            });

            const writeStream = fs.createWriteStream(outputPath);
            
            stream.pipe(writeStream);
            
            stream.on('error', (error) => {
                console.error('Download error:', error);
                reject(new Error('Failed to download video'));
            });
            
            writeStream.on('finish', () => {
                resolve(outputPath);
            });
            
            writeStream.on('error', (error) => {
                console.error('Write error:', error);
                reject(new Error('Failed to save video'));
            });
            
        } catch (error) {
            reject(error);
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

// API route for video processing
app.post('/api/process', async (req, res) => {
    try {
        const { videoId } = req.body;
        
        if (!videoId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Video ID is required' 
            });
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid YouTube URL' 
            });
        }

        console.log('Processing video:', videoId);

        // Get video info
        const videoInfo = await getVideoInfo(videoId);
        
        if (videoInfo.duration > 1800) { // 30 minutes limit
            return res.status(400).json({ 
                success: false, 
                error: 'Video is too long. Please use videos shorter than 30 minutes.' 
            });
        }

        // Download video
        const downloadedPath = await downloadVideo(videoId);
        
        // Create viral clip
        const viralClipPath = await createViralClip(downloadedPath, videoId);
        
        const clipId = path.basename(viralClipPath, '.mp4');
        
        res.json({
            success: true,
            videoId: clipId,
            url: `/api/videos/${clipId}`,
            originalTitle: videoInfo.title,
            message: 'Viral clip created successfully!'
        });

    } catch (error) {
        console.error('Processing error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to process video' 
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

// Video info route
app.get('/api/info/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        const info = await getVideoInfo(videoId);
        res.json(info);
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get video info' });
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
