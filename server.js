
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const https = require('https');

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS for all requests
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// Ensure directories exist
const videosDir = path.join(__dirname, 'videos');
const processedDir = path.join(videosDir, 'processed');

if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
}
if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
}

// Helper function to download sample video
function downloadSampleVideo(videoId, callback) {
    // For demo purposes, we'll create a sample video file
    // In production, you'd use youtube-dl or similar
    const sampleVideoUrl = 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';
    const outputPath = path.join(processedDir, `${videoId}.mp4`);
    
    // Check if file already exists
    if (fs.existsSync(outputPath)) {
        return callback(null, outputPath);
    }
    
    // For demo, create a placeholder file
    const placeholderContent = Buffer.from('DEMO_VIDEO_CONTENT');
    fs.writeFileSync(outputPath, placeholderContent);
    
    // Simulate processing delay
    setTimeout(() => {
        callback(null, outputPath);
    }, 2000);
}

// API route for video processing
app.post('/api/process', (req, res) => {
    const { videoId } = req.body;
    
    console.log('Processing video with ID:', videoId);
    
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Video ID is required' 
        });
    }
    
    // Process the video
    downloadSampleVideo(videoId, (error, videoPath) => {
        if (error) {
            console.error('Error processing video:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to process video: ' + error.message 
            });
        }
        
        const processedId = `processed_${Date.now()}`;
        const processedPath = path.join(processedDir, `${processedId}.mp4`);
        
        // Copy the video to processed directory
        fs.copyFileSync(videoPath, processedPath);
        
        res.json({
            success: true,
            videoId: processedId,
            url: `/api/videos/${processedId}`,
            message: 'Video processed successfully!'
        });
    });
});

// Route for serving videos
app.get('/api/videos/:id', (req, res) => {
    const { id } = req.params;
    const videoPath = path.join(processedDir, `${id}.mp4`);
    
    console.log('Serving video:', id);
    console.log('Video path:', videoPath);
    
    if (!fs.existsSync(videoPath)) {
        console.log('Video file not found:', videoPath);
        return res.status(404).json({
            error: 'Video not found',
            id: id,
            path: videoPath
        });
    }
    
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
        // Support for video streaming
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    }
});

// Route for sample video
app.get('/api/videos/sample', (req, res) => {
    const sampleId = `sample_${Date.now()}`;
    
    downloadSampleVideo(sampleId, (error, videoPath) => {
        if (error) {
            return res.status(500).json({ 
                error: 'Failed to generate sample video' 
            });
        }
        
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    });
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
        port: port
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        path: req.path 
    });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    console.log(`Access the site at: http://0.0.0.0:${port}`);
    console.log(`Health check: http://0.0.0.0:${port}/health`);
});
