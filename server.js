/**
 * Complete Express server with all compatibility improvements
 * This file combines all optimizations into a single server
 * Modified to be compatible with Render.com platform
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const videoRoutes = require('./routes/video-routes');

const app = express();
// Use the port provided by Render or port 3000 locally
const port = process.env.PORT || 3000;

// Enable CORS for all requests
app.use(cors());

// Parse JSON requests
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use('/static', express.static(path.join(__dirname, 'src', 'static')));

// Register video routes
app.use('/api', videoRoutes);

// API route for video processing (simulation)
app.post('/api/process', (req, res) => {
  const { videoId } = req.body;
  
  console.log('Processing video with ID:', videoId);
  
  if (!videoId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Video ID is required' 
    });
  }
  
  // Simulate video processing
  setTimeout(() => {
    // Generate unique ID for processed video
    const processedId = `processed_${Date.now()}`;
    
    // Create videos directory if it doesn't exist
    const videosDir = path.join(__dirname, 'videos');
    const processedDir = path.join(videosDir, 'processed');
    
    try {
      // Ensure directories exist
      if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
      }
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      
      // Create a dummy video file (since we don't have a real sample)
      const processedPath = path.join(processedDir, `${processedId}.mp4`);
      fs.writeFileSync(processedPath, 'dummy video content');
      
      res.json({
        success: true,
        videoId: processedId,
        url: `/api/videos/${processedId}`
      });
    } catch (error) {
      console.error('Error processing video:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to process video' 
      });
    }
  }, 2000); // Simulate processing delay
});

// Homepage route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check route for Render
app.get('/health', (req, res) => {
  res.status(200).send('Server is running properly');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Server error occurred');
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`You can access the site at: http://0.0.0.0:${port}`);
});
