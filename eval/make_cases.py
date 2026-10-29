"""Generate a small synthetic benchmark (images + cases.json). Add your own real photos
(use the 📷 button in the app) by appending entries to cases.json: same format."""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))  # paths below are relative to eval/
import json
from PIL import Image, ImageDraw, ImageFont

W, H = 1204, 672
def canvas(): im = Image.new('RGB', (W, H), (236, 236, 232)); return im, ImageDraw.Draw(im)
def font(sz):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', sz)
    except OSError: return ImageFont.load_default()

cases = []
def save(im, name): im.save(f'images/{name}.jpg', quality=90); return f'images/{name}.jpg'

# 1 colour QA
im, d = canvas(); d.ellipse([800, 100, 1050, 350], fill=(30, 90, 200)); d.rectangle([150, 300, 400, 550], fill=(200, 30, 30))
cases.append(dict(id='colour', type='chat', image=save(im, 'colour'), question='What colour is the circle? One word.', expect_any=['blue']))

# 2 counting
im, d = canvas()
for i in range(3): d.rectangle([150 + i * 350, 250, 350 + i * 350, 450], fill=(200, 30, 30))
cases.append(dict(id='count', type='chat', image=save(im, 'count'), question='How many red squares are there? Answer with a number.', expect_any=['3', 'three']))

# 3 reading text (Read mode)
im, d = canvas(); d.text((150, 260), 'OPEN 24 HOURS', fill=(20, 20, 20), font=font(110))
cases.append(dict(id='read', type='chat', mode='read', image=save(im, 'read'), question='What does the sign say?', expect_all=['open', '24']))

# 4 spatial description (Describe mode)
im, d = canvas(); d.rectangle([100, 250, 350, 500], fill=(200, 30, 30)); d.ellipse([850, 250, 1100, 500], fill=(30, 90, 200))
cases.append(dict(id='describe', type='chat', mode='describe', image=save(im, 'describe'), question='Describe the scene.', expect_all=['red', 'blue']))

# 5 teach-me memory: an invented name the model cannot know
im, d = canvas(); d.polygon([(600, 150), (800, 500), (400, 500)], fill=(30, 160, 60))
cases.append(dict(id='teach', type='chat', image=save(im, 'teach'), facts=['the green triangle is called a Zorp'],
                  question='What is the green triangle called?', expect_any=['zorp']))

# 6-8 detection: IoU against ground-truth boxes (pixel coords in the 1204x672 frame)
im, d = canvas(); d.rectangle([120, 330, 360, 570], fill=(200, 30, 30)); d.ellipse([840, 80, 1080, 320], fill=(30, 90, 200)); d.polygon([(600, 100), (720, 340), (480, 340)], fill=(30, 160, 60))
p = save(im, 'shapes')
cases.append(dict(id='detect_all', type='detect', image=p, targets=[dict(label='red', box=[120, 330, 360, 570]), dict(label='blue', box=[840, 80, 1080, 320]), dict(label='green', box=[480, 100, 720, 340])]))
cases.append(dict(id='detect_find_red', type='detect', image=p, query='the red square', targets=[dict(label='red', box=[120, 330, 360, 570])]))
cases.append(dict(id='detect_find_blue', type='detect', image=p, query='the blue circle', targets=[dict(label='blue', box=[840, 80, 1080, 320])]))

json.dump(cases, open('cases.json', 'w'), indent=1)
print(len(cases), 'cases written')
