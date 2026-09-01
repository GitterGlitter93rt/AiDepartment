from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from pypdf import PdfReader, PdfWriter
from pathlib import Path
import ast
import math

# Commercial form definitions remain in the original generator for now.
# Read them without importing/executing that module.
SOURCE = Path('tools/generate_roi_forms.py')
module = ast.parse(SOURCE.read_text())
F = None
for node in module.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == 'F':
                F = ast.literal_eval(node.value)
                break
    if F is not None:
        break
if F is None:
    raise RuntimeError('Could not locate ROI form definitions in tools/generate_roi_forms.py')

OUT=Path('docs/07-sales/training-manual/roi-forms/generated')
OUT.mkdir(parents=True, exist_ok=True)
NAVY=HexColor('#08111F'); SLATE=HexColor('#111C2E'); BLUE=HexColor('#2563EB'); CYAN=HexColor('#22D3EE')
CLOUD=HexColor('#F7F9FC'); EMERALD=HexColor('#10B981'); GRAY=HexColor('#667085'); MUTED=HexColor('#94A3B8')
BORDER=HexColor('#CBD5E1'); PALE_BLUE=HexColor('#EFF6FF'); PALE_GREEN=HexColor('#ECFDF3'); PALE_GRAY=HexColor('#F1F5F9')
W,H=letter; M=.40*inch; GAP=.16*inch

def lines(text,font,size,width):
    out=[]; line=''
    for word in text.split():
        test=(line+' '+word).strip()
        if stringWidth(test,font,size)<=width:
            line=test
        else:
            if line: out.append(line)
            line=word
    if line: out.append(line)
    return out


def write(c,text,x,y,width,size=6.7,color=SLATE,max_lines=2,leading=7.8):
    c.setFont('Helvetica',size); c.setFillColor(color)
    for ln in lines(text,'Helvetica',size,width)[:max_lines]:
        c.drawString(x,y,ln); y-=leading


def field(c,name,x,y,w,h=.20*inch,size=7.5,multi=False):
    c.acroForm.textfield(
        name=name,x=x,y=y,width=w,height=h,borderWidth=.7,
        borderColor=BORDER,fillColor=white,textColor=SLATE,forceBorder=True,
        fontName='Helvetica',fontSize=size,fieldFlags=4096 if multi else 0)


def section_label(c,text,y,right_text=None):
    c.setFillColor(NAVY); c.setFont('Helvetica-Bold',8.4); c.drawString(M,y,text)
    if right_text:
        c.setFillColor(GRAY); c.setFont('Helvetica',5.8); c.drawRightString(W-M,y,right_text)


def make_page(spec,path,form_index=None,page_no=None,total_pages=None,kit_label=None):
    slug,title,use,inputs,outputs,formula,guard=spec
    c=canvas.Canvas(str(path),pagesize=letter)
    c.setFillColor(CLOUD); c.rect(0,0,W,H,fill=1,stroke=0)

    c.setFillColor(NAVY); c.rect(0,H-.58*inch,W,.58*inch,fill=1,stroke=0)
    c.setFillColor(CYAN); c.setFont('Helvetica-Bold',7.2); c.drawString(M,H-.20*inch,'YOUR AI DEPARTMENT')
    c.setFillColor(white); c.setFont('Helvetica-Bold',14.2); c.drawString(M,H-.43*inch,title)
    if form_index is not None:
        c.setFont('Helvetica-Bold',7.0); c.drawRightString(W-M,H-.22*inch,f'ROI-{form_index:02d}')
    c.setFont('Helvetica',6.3); c.drawRightString(W-M,H-.42*inch,kit_label or 'FIELD ROI WORKSHEET')

    y=H-.76*inch
    c.setFillColor(PALE_BLUE); c.roundRect(M,y-.25*inch,W-2*M,.25*inch,4,fill=1,stroke=0)
    c.setFillColor(BLUE); c.setFont('Helvetica-Bold',6.2); c.drawString(M+.08*inch,y-.10*inch,'USE')
    write(c,use,M+.42*inch,y-.10*inch,W-2*M-.50*inch,size=6.3,max_lines=1,leading=7)
    y-=.38*inch

    labels=[('COMPANY','company',2.7),('DATE','date',1.25),('REP','rep',2.25)]
    x=M
    total_units=sum(v for _,_,v in labels); usable=W-2*M-2*GAP
    for i,(lab,sfx,units) in enumerate(labels):
        w=usable*units/total_units
        c.setFillColor(GRAY); c.setFont('Helvetica-Bold',5.8); c.drawString(x,y,lab)
        field(c,slug+'_'+sfx,x,y-.23*inch,w,h=.17*inch,size=7.0)
        x += w + (GAP if i < len(labels)-1 else 0)
    y-=.36*inch

    section_label(c,'INPUTS',y,'Source code: V verified | C client estimate | B benchmark | A assumption')
    y-=.15*inch
    cols=3; cw=(W-2*M-(cols-1)*GAP)/cols; rh=.43*inch; sw=.24*inch
    for i,lab in enumerate(inputs):
        r=i//cols; col=i%cols; x=M+col*(cw+GAP); yy=y-r*rh
        c.setFillColor(SLATE); c.setFont('Helvetica-Bold',6.25)
        ll=lines(lab,'Helvetica-Bold',6.25,cw-.04*inch)
        c.drawString(x,yy,ll[0])
        if len(ll)>1:
            c.setFillColor(GRAY); c.setFont('Helvetica',5.65); c.drawString(x,yy-.08*inch,ll[1])
        fy=yy-.28*inch
        field(c,f'{slug}_in_{i+1}',x,fy,cw-sw-.04*inch,h=.17*inch,size=7.0)
        field(c,f'{slug}_src_{i+1}',x+cw-sw,fy,sw,h=.17*inch,size=6.5)
    y-=math.ceil(len(inputs)/cols)*rh+.02*inch

    c.setFillColor(PALE_GRAY); c.roundRect(M,y-.27*inch,W-2*M,.27*inch,4,fill=1,stroke=0)
    c.setFillColor(NAVY); c.setFont('Helvetica-Bold',6.0); c.drawString(M+.08*inch,y-.105*inch,'LOGIC')
    write(c,formula,M+.48*inch,y-.105*inch,W-2*M-.56*inch,size=6.15,max_lines=1,leading=7)
    y-=.40*inch

    section_label(c,'OUTPUTS / SCENARIO',y)
    y-=.14*inch
    orh=.47*inch; ow=cw
    for i,lab in enumerate(outputs):
        r=i//cols; col=i%cols; x=M+col*(ow+GAP); yy=y-r*orh
        c.setFillColor(white); c.roundRect(x,yy-.35*inch,ow,.35*inch,4,fill=1,stroke=0)
        c.setFillColor(GRAY); c.setFont('Helvetica-Bold',5.8)
        ll=lines(lab,'Helvetica-Bold',5.8,ow-.12*inch)
        c.drawString(x+.06*inch,yy-.09*inch,ll[0])
        if len(ll)>1:
            c.setFont('Helvetica',5.35); c.drawString(x+.06*inch,yy-.16*inch,ll[1])
        field(c,f'{slug}_out_{i+1}',x+.06*inch,yy-.31*inch,ow-.12*inch,h=.14*inch,size=6.8)
    y-=math.ceil(len(outputs)/cols)*orh+.02*inch

    section_label(c,'VERIFY / NEXT STEP',y)
    y-=.14*inch
    nw=(W-2*M-GAP)/2
    for j,(lab,sfx) in enumerate([('Missing data / verification','verify'),('Recommended next action','next')]):
        x=M+j*(nw+GAP)
        c.setFillColor(GRAY); c.setFont('Helvetica-Bold',5.9); c.drawString(x,y,lab)
        field(c,f'{slug}_{sfx}',x,y-.29*inch,nw,h=.22*inch,size=6.8,multi=True)
    y-=.40*inch

    c.setFillColor(PALE_GREEN); c.roundRect(M,y-.33*inch,W-2*M,.33*inch,4,fill=1,stroke=0)
    c.setFillColor(EMERALD); c.setFont('Helvetica-Bold',5.9); c.drawString(M+.08*inch,y-.105*inch,'CLAIM DISCIPLINE')
    write(c,guard,M+1.02*inch,y-.105*inch,W-2*M-1.10*inch,size=5.9,max_lines=2,leading=6.8)

    c.setFillColor(MUTED); c.setFont('Helvetica',5.5)
    c.drawString(M,.18*inch,'Scenario estimate only - not guaranteed revenue, savings, or ROI.')
    if page_no and total_pages:
        c.drawCentredString(W/2,.18*inch,f'Page {page_no} of {total_pages}')
    c.drawRightString(W-M,.18*inch,'YourAIDepartment.ai')
    c.save()


def combine(specs,out_path,kit_label):
    tmp=OUT/'_tmp_pages'; tmp.mkdir(exist_ok=True)
    writer=PdfWriter(); total=len(specs)
    for page_no,(idx,spec) in enumerate(specs,1):
        p=tmp/f'{kit_label.lower().replace(" ","_")}_{page_no:02d}.pdf'
        make_page(spec,p,form_index=idx,page_no=page_no,total_pages=total,kit_label=kit_label)
        reader=PdfReader(str(p)); assert len(reader.pages)==1
        writer.append(reader)
    with open(out_path,'wb') as fp: writer.write(fp)
    for p in tmp.glob('*.pdf'): p.unlink()
    try: tmp.rmdir()
    except OSError: pass


files=[]
for idx,spec in enumerate(F,1):
    p=OUT/(spec[0]+'.pdf')
    make_page(spec,p,form_index=idx,kit_label='FIELD ROI WORKSHEET')
    files.append(p)

master_specs=[(i,s) for i,s in enumerate(F,1)]
combine(master_specs,OUT/'YAD_ROI_Forms_One_Page_Pack.pdf','MASTER ROI LIBRARY')

core_indexes=[1,2,6,14]
core_specs=[(i,F[i-1]) for i in core_indexes]
combine(core_specs,OUT/'YAD_ROI_Core_Field_Kit.pdf','CORE FIELD KIT')

print('Generated',len(files),'compact one-page forms, 14-page master pack, and 4-page core field kit')
