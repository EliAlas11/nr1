/**
 * تكامل جميع تحسينات التوافق مع خادم Express
 * هذا الملف يقوم بدمج جميع التحسينات في خادم واحد
 * تم تعديله ليكون متوافقاً مع منصة Render.com
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const videoRoutes = require('./routes/video-routes');

const app = express();
// استخدام المنفذ الذي توفره Render أو المنفذ 3000 محلياً
const port = process.env.PORT || 3000;

// تمكين CORS لجميع الطلبات
app.use(cors());

// تحليل طلبات JSON
app.use(express.json());

// تقديم الملفات الثابتة
app.use(express.static(path.join(__dirname)));
app.use('/static', express.static(path.join(__dirname, 'src', 'static')));

// تسجيل مسارات الفيديو
app.use('/api', videoRoutes);

// مسار API لمعالجة الفيديو (محاكاة)
app.post('/api/process', (req, res) => {
  const { videoId } = req.body;
  
  if (!videoId) {
    return res.status(400).json({ error: 'معرف الفيديو مطلوب' });
  }
  
  // محاكاة معالجة الفيديو
  setTimeout(() => {
    // إنشاء معرف فريد للفيديو المعالج
    const processedId = `processed_${Date.now()}`;
    
    // في التطبيق الحقيقي، سنقوم بمعالجة الفيديو وحفظه
    // هنا نقوم فقط بنسخ ملف العينة
    const samplePath = path.join(__dirname, 'videos', 'sample.mp4');
    const processedPath = path.join(__dirname, 'videos', 'processed', `${processedId}.mp4`);
    
    try {
      // التأكد من وجود المجلد
      if (!fs.existsSync(path.join(__dirname, 'videos', 'processed'))) {
        fs.mkdirSync(path.join(__dirname, 'videos', 'processed'), { recursive: true });
      }
      
      // نسخ ملف العينة
      fs.copyFileSync(samplePath, processedPath);
      
      res.json({
        success: true,
        videoId: processedId,
        url: `/api/videos/${processedId}`
      });
    } catch (error) {
      console.error('خطأ في معالجة الفيديو:', error);
      res.status(500).json({ error: 'فشل في معالجة الفيديو' });
    }
  }, 2000); // محاكاة تأخير المعالجة
});

// مسار الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// مسار فحص الصحة لـ Render
app.get('/health', (req, res) => {
  res.status(200).send('الخادم يعمل بشكل صحيح');
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
  console.error('خطأ في الخادم:', err);
  res.status(500).send('حدث خطأ في الخادم');
});

// بدء الخادم
app.listen(port, () => {
  console.log(`الخادم يعمل على المنفذ ${port}`);
  console.log(`يمكنك الوصول إلى الموقع من خلال: http://localhost:${port}`);
});
