const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit');

// Set FFmpeg path with error handling
try {
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('✅ FFmpeg configured successfully');
} catch (error) {
    console.warn('⚠️ FFmpeg installer not found, using system FFmpeg');
    // Will use system FFmpeg if available
}

const app = express();
const port = process.env.PORT || 5000;

// Enhanced trust proxy configuration for Replit
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// CORS configuration
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

// Fixed rate limiting for Replit environment
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // increased limit for development
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 15 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress || 'unknown';
    },
    skip: (req) => {
        return req.path === '/health' || 
               req.path.startsWith('/api/videos/') || 
               req.method === 'OPTIONS';
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

// Clean up old files
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
                            if (!err) console.log(`🧹 Cleaned up old file: ${file}`);
                        });
                    }
                });
            });
        });
    });
}

setInterval(cleanupOldFiles, 30 * 60 * 1000);

// Enhanced YouTube URL validation
function extractVideoId(url) {
    try {
        if (!url || typeof url !== 'string') return null;

        url = url.trim().replace(/\s+/g, '');

        // If it's already just an ID
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
            return url;
        }

        const patterns = [
            /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /(?:m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
            /[?&]v=([a-zA-Z0-9_-]{11})/
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

// Enhanced video info retrieval with better error handling
async function getVideoInfo(videoId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            console.log('⏰ Video info timeout for:', videoId);
            reject(new Error('Request timeout - video may be unavailable'));
        }, 30000);

        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            console.log('🔍 Getting video info for:', videoId, 'URL:', url);

            if (!videoId || videoId.length !== 11 || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
                clearTimeout(timeout);
                console.error('❌ Invalid video ID format:', videoId);
                reject(new Error('Invalid video ID format'));
                return;
            }

            // First validate the URL
            try {
                if (!ytdl.validateURL(url)) {
                    clearTimeout(timeout);
                    console.error('❌ Invalid YouTube URL:', url);
                    reject(new Error('Invalid YouTube URL'));
                    return;
                }
            } catch (validateError) {
                clearTimeout(timeout);
                console.error('❌ URL validation error:', validateError);
                reject(new Error('Failed to validate YouTube URL: ' + validateError.message));
                return;
            }

            console.log('✅ URL validation passed, getting info...');

            ytdl.getInfo(url, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                }
            }).then(info => {
                clearTimeout(timeout);
                console.log('📄 Raw video info received');

                if (!info || !info.videoDetails) {
                    console.error('❌ No video details in response');
                    reject(new Error('Invalid video information received'));
                    return;
                }

                const duration = parseInt(info.videoDetails.lengthSeconds) || 0;
                console.log('⏱️ Video duration:', duration, 'seconds');

                if (duration > 1800) {
                    reject(new Error('Video is too long. Maximum duration is 30 minutes.'));
                    return;
                }

                if (duration < 10) {
                    reject(new Error('Video is too short. Minimum duration is 10 seconds.'));
                    return;
                }

                const result = {
                    title: info.videoDetails.title || 'Unknown Title',
                    duration: duration,
                    description: info.videoDetails.description || '',
                    thumbnails: info.videoDetails.thumbnails || [],
                    viewCount: info.videoDetails.viewCount || '0',
                    author: info.videoDetails.author?.name || 'Unknown Author'
                };

                console.log('✅ Video info retrieved successfully:', result.title);
                resolve(result);

            }).catch(error => {
                clearTimeout(timeout);
                console.error('❌ ytdl.getInfo error:', error);

                let errorMessage = 'Failed to get video information';

                // Handle both error objects and strings
                const errorString = error ? (error.message || error.toString() || JSON.stringify(error)) : 'Unknown error';
                console.error('❌ Error details:', errorString);

                if (errorString) {
                    if (errorString.includes('Video unavailable') || errorString.includes('unavailable')) {
                        errorMessage = 'Video is unavailable, private, or deleted';
                    } else if (errorString.includes('Sign in') || errorString.includes('age')) {
                        errorMessage = 'Age-restricted video - cannot access';
                    } else if (errorString.includes('This video is not available') || errorString.includes('not available')) {
                        errorMessage = 'Video is not available in this region';
                    } else if (errorString.includes('Private video') || errorString.includes('private')) {
                        errorMessage = 'This is a private video';
                    } else if (errorString.includes('429') || errorString.includes('Too Many Requests')) {
                        errorMessage = 'Too many requests - please try again later';
                    } else if (errorString.includes('403') || errorString.includes('Forbidden')) {
                        errorMessage = 'Access forbidden - video may be restricted';
                    } else if (errorString.includes('404') || errorString.includes('Not Found')) {
                        errorMessage = 'Video not found or URL is invalid';
                    } else if (errorString.includes('network') || errorString.includes('ENOTFOUND')) {
                        errorMessage = 'Network error - please check your connection';
                    } else {
                        errorMessage = `Failed to access video: ${errorString}`;
                    }
                } else {
                    errorMessage = 'Unknown error occurred while getting video information';
                }

                reject(new Error(errorMessage));
            });

        } catch (error) {
            clearTimeout(timeout);
            console.error('❌ Video info setup error:', error);
            reject(new Error('Failed to initialize video info request: ' + (error.message || 'Unknown error')));
        }
    });
}

// Enhanced video download
async function downloadVideo(videoId) {
    return new Promise((resolve, reject) => {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const outputPath = path.join(tempDir, `${videoId}_original.mp4`);

        console.log('📥 Starting download for video:', videoId);

        // Check if file already exists
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 50000) {
                console.log('✅ Using cached video:', outputPath);
                return resolve(outputPath);
            } else {
                try {
                    fs.unlinkSync(outputPath);
                } catch (e) {
                    console.warn('Could not remove invalid cached file:', e.message);
                }
            }
        }

        let downloadTimeout = setTimeout(() => {
            console.log('⏰ Download timeout reached');
            reject(new Error('Download timeout - video may be too large'));
        }, 2 * 60 * 1000);

        try {
            const stream = ytdl(url, {
                quality: 'highest',
                filter: 'audioandvideo',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }
            });

            const writeStream = fs.createWriteStream(outputPath);
            stream.pipe(writeStream);

            stream.on('error', (error) => {
                clearTimeout(downloadTimeout);
                console.error('❌ Download stream error:', error.message);

                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) {}
                }

                if (error.message.includes('Video unavailable')) {
                    reject(new Error('Video is unavailable, private, or deleted'));
                } else if (error.message.includes('Sign in')) {
                    reject(new Error('Age-restricted video - cannot download'));
                } else {
                    reject(new Error('Failed to download video: ' + error.message));
                }
            });

            writeStream.on('finish', () => {
                clearTimeout(downloadTimeout);
                console.log('✅ Download completed:', outputPath);

                try {
                    const stats = fs.statSync(outputPath);
                    if (stats.size < 50000) {
                        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                        reject(new Error('Downloaded file is too small'));
                    } else {
                        console.log(`📁 File size: ${Math.round(stats.size / 1024 / 1024)}MB`);
                        resolve(outputPath);
                    }
                } catch (statError) {
                    reject(new Error('Failed to verify downloaded file'));
                }
            });

            writeStream.on('error', (error) => {
                clearTimeout(downloadTimeout);
                console.error('❌ Write stream error:', error.message);
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) {}
                }
                reject(new Error('Failed to save video file'));
            });

        } catch (error) {
            clearTimeout(downloadTimeout);
            console.error('❌ Download setup error:', error);
            reject(new Error('Failed to initialize video download'));
        }
    });
}

// Create viral clip
async function createViralClip(inputPath, videoId) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(processedDir, `viral_${videoId}_${Date.now()}.mp4`);

        console.log('🎬 Creating viral clip for:', videoId);

        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error('❌ FFprobe error:', err);
                return reject(new Error('Failed to analyze video'));
            }

            const duration = metadata.format.duration;
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');

            if (!videoStream) {
                return reject(new Error('No video stream found'));
            }

            const clipDuration = Math.min(30, Math.max(10, duration * 0.8));
            const startTime = Math.max(0, (duration - clipDuration) / 3);

            console.log(`🎯 Processing clip: ${clipDuration}s from ${Math.round(startTime)}s`);

            const command = ffmpeg(inputPath)
                .setStartTime(startTime)
                .setDuration(clipDuration)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset', 'fast',
                    '-crf', '23',
                    '-maxrate', '8M',
                    '-bufsize', '16M',
                    '-movflags', '+faststart',
                    '-ac', '2',
                    '-ar', '48000',
                    '-b:a', '128k',
                    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p',
                    '-aspect', '9:16'
                ])
                .output(outputPath);

            command
                .on('start', (commandLine) => {
                    console.log('🔧 FFmpeg command started');
                })
                .on('progress', (progress) => {
                    const percent = Math.round(progress.percent || 0);
                    if (percent % 20 === 0) {
                        console.log(`⚡ Processing: ${percent}%`);
                    }
                })
                .on('end', () => {
                    console.log('✅ Viral clip created:', outputPath);

                    if (fs.existsSync(outputPath)) {
                        const stats = fs.statSync(outputPath);
                        if (stats.size > 50000) {
                            console.log(`📁 Output size: ${Math.round(stats.size / 1024 / 1024)}MB`);
                            resolve(outputPath);
                        } else {
                            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                            reject(new Error('Generated clip file is too small'));
                        }
                    } else {
                        reject(new Error('Output file was not created'));
                    }
                })
                .on('error', (error) => {
                    console.error('❌ FFmpeg error:', error);
                    if (fs.existsSync(outputPath)) {
                        try { fs.unlinkSync(outputPath); } catch (e) {}
                    }
                    reject(new Error('Failed to process video'));
                })
                .run();
        });
    });
}

// API Routes

// Enhanced validation endpoint
app.post('/api/validate', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        console.log('🔍 Validating URL:', url);

        const videoId = extractVideoId(url);

        if (!videoId) {
            return res.json({
                success: true,
                isValid: false,
                videoId: null,
                error: 'Invalid YouTube URL format'
            });
        }

        // Test if video is accessible
        let canAccess = false;
        let accessError = null;

        try {
            const testUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // First check URL validity
            let isValid = false;
            try {
                isValid = ytdl.validateURL(testUrl);
            } catch (validateError) {
                console.warn('⚠️ URL validation failed:', validateError);
                accessError = 'Invalid YouTube URL format';
            }

            if (isValid) {
                try {
                    await ytdl.getBasicInfo(testUrl, {
                        requestOptions: {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        }
                    });
                    canAccess = true;
                } catch (basicInfoError) {
                    console.warn('⚠️ Basic info fetch failed:', basicInfoError);
                    if (basicInfoError && basicInfoError.message) {
                        if (basicInfoError.message.includes('Video unavailable')) {
                            accessError = 'Video is unavailable, private, or deleted';
                        } else if (basicInfoError.message.includes('Sign in')) {
                            accessError = 'Age-restricted video - cannot process';
                        } else {
                            accessError = 'Video may not be accessible: ' + basicInfoError.message;
                        }
                    } else {
                        accessError = 'Video may not be accessible (unknown error)';
                    }
                }
            }
        } catch (testError) {
            console.warn('⚠️ Video access test failed:', testError);
            accessError = 'Failed to test video accessibility: ' + (testError.message || 'Unknown error');
        }

        res.json({
            success: true,
            isValid: canAccess,
            videoId: videoId,
            canAccess,
            warning: accessError
        });

    } catch (error) {
        console.error('❌ Validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Validation failed: ' + (error.message || 'Unknown error')
        });
    }
});

// Video info endpoint
app.get('/api/info/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;

        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid video ID format' 
            });
        }

        console.log('📄 Getting info for video ID:', videoId);
        const info = await getVideoInfo(videoId);

        res.json({
            success: true,
            ...info
        });

    } catch (error) {
        console.error('❌ Video info error for ID:', req.params.videoId, 'Error:', error);

        let statusCode = 500;
        let errorMessage = 'Failed to get video information';

        if (error && error.message) {
            errorMessage = error.message;
            if (error.message.includes('unavailable') || error.message.includes('private')) {
                statusCode = 404;
            } else if (error.message.includes('too long') || error.message.includes('too short')) {
                statusCode = 400;
            } else if (error.message.includes('timeout')) {
                statusCode = 408;
            }
        } else {
            console.error('❌ Empty error object received');
            errorMessage = 'Unknown error occurred while getting video information';
        }

        res.status(statusCode).json({ 
            success: false,
            error: errorMessage
        });
    }
});

// Main processing endpoint
app.post('/api/process', async (req, res) => {
    let downloadedPath = null;

    try {
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

        console.log('🚀 Processing video:', videoId);

        // Get video info
        const videoInfo = await getVideoInfo(videoId);
        console.log('📄 Video info retrieved:', videoInfo.title);

        // Download video
        downloadedPath = await downloadVideo(videoId);
        console.log('📥 Video downloaded');

        // Create viral clip
        const viralClipPath = await createViralClip(downloadedPath, videoId);
        console.log('🎬 Viral clip created');

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
        // Enhanced error handling with detailed logging
        const errorString = error ? (error.message || error.toString() || JSON.stringify(error)) : 'Unknown error';
        console.error('❌ Processing error details:', {
            error: errorString,
            stack: error?.stack,
            name: error?.name,
            code: error?.code
        });

        let errorMessage = errorString || 'Unknown error occurred';
        let statusCode = 500;

        if (errorString.includes('unavailable') || errorString.includes('private')) {
            statusCode = 400;
        } else if (errorString.includes('too long') || errorString.includes('too short')) {
            statusCode = 400;
        } else if (errorString.includes('timeout')) {
            statusCode = 408;
            errorMessage = 'Processing timeout. Please try a shorter video.';
        } else if (errorString.includes('403') || errorString.includes('Forbidden')) {
            statusCode = 403;
            errorMessage = 'Access forbidden - video may be restricted';
        } else if (errorString.includes('404') || errorString.includes('Not Found')) {
            statusCode = 404;
            errorMessage = 'Video not found or URL is invalid';
        }

        if (downloadedPath && fs.existsSync(downloadedPath)) {
            try {
                fs.unlinkSync(downloadedPath);
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        }

        res.status(statusCode).json({ 
            success: false, 
            error: errorMessage
        });
    }
});

// Video serving endpoint
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
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (range) {
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
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
        });

        fs.createReadStream(videoPath).pipe(res);
    }
});

// Sample video endpoint
app.get('/api/videos/sample', (req, res) => {
    const samplePath = path.join(processedDir, 'sample.mp4');

    if (fs.existsSync(samplePath)) {
        const stat = fs.statSync(samplePath);
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': 'video/mp4'
        });
        fs.createReadStream(samplePath).pipe(res);
    } else {
        res.status(404).json({ error: 'Sample video not available' });
    }
});

// Homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'Server is running properly',
        timestamp: new Date().toISOString(),
        port: port,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error'
    });
});

app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        path: req.path 
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    cleanupOldFiles();
    process.exit(0);
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Viral Clip Generator Server running on port ${port}`);
    console.log(`🌐 Access: http://0.0.0.0:${port}`);
    console.log(`❤️ Health: http://0.0.0.0:${port}/health`);

    cleanupOldFiles();
});