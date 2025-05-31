// إنشاء مجلدات للملفات المطلوبة
mkdir -p /home/ubuntu/viral_clip_generator/src/assets/sounds
mkdir -p /home/ubuntu/viral_clip_generator/src/static/css
mkdir -p /home/ubuntu/viral_clip_generator/src/static/js
mkdir -p /home/ubuntu/viral_clip_generator/src/templates
mkdir -p /home/ubuntu/viral_clip_generator/src/uploads
mkdir -p /home/ubuntu/viral_clip_generator/src/processed

// تثبيت المكتبات المطلوبة
pip install flask pytube moviepy opencv-python-headless werkzeug

// إنشاء ملفات المؤثرات الصوتية
touch /home/ubuntu/viral_clip_generator/src/assets/sounds/suspense.mp3
touch /home/ubuntu/viral_clip_generator/src/assets/sounds/dramatic.mp3
touch /home/ubuntu/viral_clip_generator/src/assets/sounds/upbeat.mp3

// إنشاء ملف requirements.txt
echo "flask==2.0.1
pytube==12.1.0
moviepy==1.0.3
opencv-python-headless==4.5.3.56
werkzeug==2.0.1" > /home/ubuntu/viral_clip_generator/requirements.txt
