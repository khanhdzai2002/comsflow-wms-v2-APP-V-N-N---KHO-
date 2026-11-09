"""Package the checked slide images into PowerPoint and an offline ZIP.
PowerPoint uses high-resolution slide images; readable text is in speaker notes.
Edit the HTML generator for content changes; do not claim the images are text boxes.
"""
from pathlib import Path
import json, zipfile
from pptx import Presentation
from pptx.util import Inches
from PIL import Image, ImageOps, ImageDraw
import fitz
root=Path(__file__).resolve().parents[2]
out=root/'public/huong-dan-hang-hoan'
notes=json.loads((out/'slides/notes.json').read_text())
prs=Presentation();prs.slide_width=Inches(13.333333);prs.slide_height=Inches(7.5)
prs.core_properties.title='COMS-FLOW — Hướng dẫn Quản lý & Đối soát hàng hoàn V2'
prs.core_properties.author='COMS-FLOW / COMSMIU'
prs.core_properties.subject='Từ hai file nguồn đến nhận kiện, kiểm SKU và xử lý ngoại lệ'
for n,note in enumerate(notes,1):
 slide=prs.slides.add_slide(prs.slide_layouts[6])
 slide.shapes.add_picture(str(out/f'slides/{n:02d}.png'),0,0,width=prs.slide_width,height=prs.slide_height)
 slide.notes_slide.notes_text_frame.text=note
prs.save(out/'Huong-dan-hang-hoan-V2.pptx')
assert len(Presentation(out/'Huong-dan-hang-hoan-V2.pptx').slides)==14
for filename,pages in [('Huong-dan-hang-hoan-V2.pdf',14),('Quy-trinh-nhan-hoan-A4.pdf',1)]:
 doc=fitz.open(out/filename)
 assert len(doc)==pages,(filename,len(doc))
 assert all(len(p.get_text())>100 for p in doc),'PDF must contain readable/selectable text'
 assert not any('\ufffd' in p.get_text() for p in doc),'Broken Vietnamese text'
 print(filename,len(doc),'pages; searchable text checked')
# Local review sheet, not a published training page.
contact=Image.new('RGB',(1600,4*250),'#e6ecf4');draw=ImageDraw.Draw(contact)
for n in range(14):
 im=Image.open(out/f'slides/{n+1:02d}.png').convert('RGB');im.thumbnail((390,220))
 x=(n%4)*400+5;y=(n//4)*250+5
 contact.paste(im,(x,y));draw.text((x,y+222),f'{n+1:02d}',fill='#17283e')
contact.save('/tmp/return-training-contact.png')
archive=out/'Bo-huong-dan-hang-hoan-V2.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for file in sorted(out.rglob('*')):
  if file.is_file() and file!=archive:z.write(file,file.relative_to(out))
print('PowerPoint: 14 slides; ZIP',archive.stat().st_size,'bytes')
