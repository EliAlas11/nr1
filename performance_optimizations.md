# تحسينات الأداء وتقليل استخدام الموارد

## 1. تحسينات الواجهة الأمامية

### تحسين تحميل CSS و JavaScript
```javascript
// تحميل CSS بشكل غير متزامن
const loadCSS = (href) => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.media = 'print';
  document.head.appendChild(link);
  
  // بعد التحميل، تغيير الوسيط إلى 'all'
  link.onload = () => {
    link.media = 'all';
  };
};

// تحميل JavaScript بشكل غير متزامن
const loadJS = (src, async = true, defer = true) => {
  const script = document.createElement('script');
  script.src = src;
  script.async = async;
  script.defer = defer;
  document.body.appendChild(script);
  return script;
};

// تحميل الموارد الأساسية أولاً، ثم الموارد الثانوية
document.addEventListener('DOMContentLoaded', () => {
  // تحميل الأيقونات بشكل غير متزامن
  loadCSS('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css');
  
  // تحميل ملفات JavaScript الإضافية بعد تحميل الصفحة
  setTimeout(() => {
    loadJS('/static/js/compatibility.js');
  }, 1000);
});
```

### ضغط الصور وتحميلها بشكل كسول
```html
<!-- استخدام تحميل الصور الكسول -->
<img src="placeholder.jpg" data-src="actual-image.jpg" loading="lazy" alt="وصف الصورة" />

<script>
  // تنفيذ تحميل الصور الكسول
  document.addEventListener('DOMContentLoaded', () => {
    const lazyImages = document.querySelectorAll('img[data-src]');
    
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            imageObserver.unobserve(img);
          }
        });
      });
      
      lazyImages.forEach(img => imageObserver.observe(img));
    } else {
      // للمتصفحات القديمة التي لا تدعم IntersectionObserver
      lazyImages.forEach(img => {
        img.src = img.dataset.src;
      });
    }
  });
</script>
```

### تحسين تقديم CSS
```css
/* استخدام will-change للعناصر التي ستتغير */
.animated-element {
  will-change: transform, opacity;
}

/* تجنب الخصائص المكلفة في الرسوم المتحركة */
@keyframes optimized-animation {
  0% { transform: translateX(0); }
  100% { transform: translateX(100px); }
}

/* استخدام transform بدلاً من left/top للرسوم المتحركة */
.efficient-animation {
  transition: transform 0.3s ease;
}
.efficient-animation:hover {
  transform: scale(1.1);
}
```

## 2. تحسينات معالجة الفيديو

### تحسين تنزيل الفيديو
```python
def optimized_download_youtube_video(video_id, resolution='720p'):
    """تنزيل فيديو YouTube بطريقة محسنة."""
    try:
        # التحقق من وجود الفيديو في ذاكرة التخزين المؤقت
        cache_path = os.path.join(app.config['CACHE_FOLDER'], f"{video_id}_{resolution}.mp4")
        if os.path.exists(cache_path):
            return cache_path
        
        # تنزيل الفيديو بالدقة المطلوبة فقط
        yt = YouTube(f"https://www.youtube.com/watch?v={video_id}")
        
        # اختيار الدقة المناسبة بناءً على المدخلات
        if resolution == '720p':
            stream = yt.streams.filter(progressive=True, file_extension='mp4', res='720p').first()
        elif resolution == '480p':
            stream = yt.streams.filter(progressive=True, file_extension='mp4', res='480p').first()
        elif resolution == '360p':
            stream = yt.streams.filter(progressive=True, file_extension='mp4', res='360p').first()
        
        # إذا لم يتم العثور على الدقة المطلوبة، استخدم أفضل دقة متاحة
        if not stream:
            stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
        
        # تنزيل الفيديو إلى ذاكرة التخزين المؤقت
        stream.download(output_path=app.config['CACHE_FOLDER'], filename=f"{video_id}_{resolution}.mp4")
        
        return cache_path
    except Exception as e:
        print(f"خطأ في تنزيل فيديو YouTube: {str(e)}")
        raise
```

### تحسين معالجة الفيديو
```python
def optimized_process_video(video_path, start_time, duration, output_path):
    """معالجة الفيديو بطريقة محسنة."""
    try:
        # استخدام FFmpeg مباشرة بدلاً من moviepy للأداء الأفضل
        command = [
            'ffmpeg',
            '-i', video_path,
            '-ss', str(start_time),
            '-t', str(duration),
            '-c:v', 'libx264',
            '-preset', 'veryfast',  # استخدام إعداد أسرع للترميز
            '-crf', '23',  # جودة مقبولة مع حجم ملف أصغر
            '-c:a', 'aac',
            '-b:a', '128k',  # معدل بت صوتي أقل
            '-y',  # الكتابة فوق الملف إذا كان موجودًا
            output_path
        ]
        
        subprocess.run(command, check=True)
        return output_path
    except Exception as e:
        print(f"خطأ في معالجة الفيديو: {str(e)}")
        raise
```

### تحسين إضافة المؤثرات الصوتية
```python
def optimized_add_sound_effect(video_path, sound_effect_path, output_path):
    """إضافة مؤثرات صوتية بطريقة محسنة."""
    try:
        # استخدام FFmpeg مباشرة للأداء الأفضل
        command = [
            'ffmpeg',
            '-i', video_path,
            '-i', sound_effect_path,
            '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2',
            '-c:v', 'copy',  # نسخ الفيديو بدون إعادة ترميز
            '-y',
            output_path
        ]
        
        subprocess.run(command, check=True)
        return output_path
    except Exception as e:
        print(f"خطأ في إضافة المؤثرات الصوتية: {str(e)}")
        raise
```

## 3. تحسينات الخادم

### استخدام ذاكرة التخزين المؤقت
```python
from functools import lru_cache
import time

# استخدام ذاكرة التخزين المؤقت للعمليات المتكررة
@lru_cache(maxsize=100)
def cached_youtube_info(video_id):
    """الحصول على معلومات فيديو YouTube مع التخزين المؤقت."""
    yt = YouTube(f"https://www.youtube.com/watch?v={video_id}")
    return {
        'title': yt.title,
        'author': yt.author,
        'length': yt.length,
        'thumbnail_url': yt.thumbnail_url
    }

# تنفيذ نظام تخزين مؤقت بسيط
class SimpleCache:
    def __init__(self, max_size=100, expiration=3600):
        self.cache = {}
        self.max_size = max_size
        self.expiration = expiration
    
    def get(self, key):
        if key in self.cache:
            item = self.cache[key]
            if time.time() - item['timestamp'] < self.expiration:
                return item['value']
            else:
                del self.cache[key]
        return None
    
    def set(self, key, value):
        if len(self.cache) >= self.max_size:
            # إزالة أقدم عنصر
            oldest_key = min(self.cache, key=lambda k: self.cache[k]['timestamp'])
            del self.cache[oldest_key]
        
        self.cache[key] = {
            'value': value,
            'timestamp': time.time()
        }

# إنشاء كائن التخزين المؤقت
video_cache = SimpleCache()
```

### تحسين معالجة الطلبات
```python
from flask import Flask, request, jsonify, send_file
from werkzeug.middleware.proxy_fix import ProxyFix
import concurrent.futures

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app)

# استخدام مجمع الخيوط للعمليات المكثفة
executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

@app.route('/api/process', methods=['POST'])
def process_video():
    try:
        data = request.json
        video_id = data.get('videoId')
        
        if not video_id:
            return jsonify({"error": "معرف الفيديو مطلوب"}), 400
        
        # التحقق من وجود النتيجة في ذاكرة التخزين المؤقت
        cached_result = video_cache.get(f"processed_{video_id}")
        if cached_result:
            return jsonify(cached_result)
        
        # تنفيذ المعالجة في خيط منفصل
        future = executor.submit(process_video_task, video_id)
        result = future.result()
        
        # تخزين النتيجة في ذاكرة التخزين المؤقت
        video_cache.set(f"processed_{video_id}", result)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

### تحسين استخدام الذاكرة
```python
import gc
import psutil

def monitor_memory_usage():
    """مراقبة استخدام الذاكرة."""
    process = psutil.Process()
    memory_info = process.memory_info()
    return {
        'rss': memory_info.rss / 1024 / 1024,  # بالميجابايت
        'vms': memory_info.vms / 1024 / 1024   # بالميجابايت
    }

def cleanup_resources():
    """تنظيف الموارد غير المستخدمة."""
    # تنظيف ذاكرة التخزين المؤقت القديمة
    cleanup_old_cache_files()
    
    # تشغيل جامع القمامة يدويًا
    gc.collect()

def cleanup_old_cache_files(max_age=3600):
    """تنظيف ملفات ذاكرة التخزين المؤقت القديمة."""
    cache_dir = app.config['CACHE_FOLDER']
    current_time = time.time()
    
    for filename in os.listdir(cache_dir):
        file_path = os.path.join(cache_dir, filename)
        
        # التحقق من عمر الملف
        file_age = current_time - os.path.getmtime(file_path)
        
        if file_age > max_age:
            try:
                os.remove(file_path)
                print(f"تم حذف ملف ذاكرة التخزين المؤقت القديم: {filename}")
            except Exception as e:
                print(f"خطأ في حذف ملف ذاكرة التخزين المؤقت: {str(e)}")
```

## 4. تحسينات عامة

### ضغط الاستجابات
```python
from flask_compress import Compress

# تمكين ضغط الاستجابات
compress = Compress()
compress.init_app(app)
```

### تحسين تحميل الصفحة
```python
# إضافة رؤوس التخزين المؤقت
@app.after_request
def add_cache_headers(response):
    # تخزين مؤقت للموارد الثابتة
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'public, max-age=31536000'
    # تخزين مؤقت قصير للصفحات الديناميكية
    else:
        response.headers['Cache-Control'] = 'public, max-age=60'
    
    return response
```

### تحسين تجربة المستخدم أثناء التحميل
```javascript
// عرض تقدم التحميل للمستخدم
function showProgressIndicator(elementId, progress) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.width = `${progress}%`;
    element.textContent = `${Math.round(progress)}%`;
  }
}

// تنفيذ مؤشر تقدم للتحميل
async function processVideoWithProgress(videoId) {
  const progressBar = document.getElementById('progressBar');
  progressBar.style.display = 'block';
  
  // محاكاة تقدم التحميل
  let progress = 0;
  const interval = setInterval(() => {
    progress += 5;
    if (progress > 90) {
      clearInterval(interval);
    }
    showProgressIndicator('progressValue', progress);
  }, 300);
  
  try {
    // استدعاء API
    const response = await fetch('/api/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoId })
    });
    
    // إكمال التقدم عند الانتهاء
    clearInterval(interval);
    showProgressIndicator('progressValue', 100);
    
    // إخفاء شريط التقدم بعد فترة قصيرة
    setTimeout(() => {
      progressBar.style.display = 'none';
    }, 500);
    
    return await response.json();
  } catch (error) {
    clearInterval(interval);
    progressBar.style.display = 'none';
    throw error;
  }
}
```
