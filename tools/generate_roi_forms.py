from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from pypdf import PdfReader, PdfWriter
from pathlib import Path
import math

OUT=Path('docs/07-sales/training-manual/roi-forms/generated')
OUT.mkdir(parents=True, exist_ok=True)
NAVY=HexColor('#08111F'); SLATE=HexColor('#111C2E'); BLUE=HexColor('#2563EB'); CYAN=HexColor('#22D3EE')
CLOUD=HexColor('#F7F9FC'); EMERALD=HexColor('#10B981'); GRAY=HexColor('#667085'); MUTED=HexColor('#94A3B8')
BORDER=HexColor('#CBD5E1'); PALE_BLUE=HexColor('#EFF6FF'); PALE_GREEN=HexColor('#ECFDF3'); PALE_GRAY=HexColor('#F1F5F9')
W,H=letter; M=.40*inch; GAP=.16*inch

F=[
('01_missed_call_roi','Missed Call ROI','Use when inbound calls go unanswered, overflow, or hit voicemail after hours.',
 ['Monthly inbound calls','Unanswered / missed %','Legitimate new-business %','Scenario capture / close %','Average customer revenue','Optional gross margin %'],
 ['Unanswered calls','Theoretical revenue exposure','Qualified missed opportunities','Scenario customers','Monthly recoverable scenario','Annual recoverable scenario'],
 'Calls x missed % -> qualified % -> scenario close % -> customer value','Exposure is not guaranteed revenue. Do not assume every missed call would become a customer.'),
('02_lead_response_roi','Lead Response ROI','Use when inbound leads are contacted slowly or inconsistently.',
 ['Monthly inbound leads','Current conversion %','Scenario conversion %','Average customer revenue','Current response time','Desired response workflow'],
 ['Current customers / month','Scenario customers / month','Additional scenario customers','Monthly revenue scenario','Annual revenue scenario'],
 'Leads x conversion rate; compare current vs scenario conversion','Do not invent a conversion lift. Use client data or a clearly labeled scenario.'),
('03_unsold_estimate_followup_roi','Unsold Estimate / Follow-Up ROI','Use when estimates, proposals, or quotes are not followed up systematically.',
 ['Estimates / proposals per month','Unsold after first presentation %','Legitimate recoverable %','Scenario recovery / close %','Average sold job / contract revenue'],
 ['Unsold estimates','Theoretical exposure','Qualified recoverable estimates','Scenario recovered customers','Monthly recoverable scenario','Annual recoverable scenario'],
 'Estimates x unsold % -> recoverable % -> scenario close % -> job value','Not every unsold estimate is recoverable. Separate total exposure from realistic recovery.'),
('04_lead_reactivation_roi','Lead Reactivation ROI','Use for old leads, unsold estimates, former customers, or inactive databases.',
 ['Inactive leads / contacts','Contactable %','Response-rate scenario %','Qualification / appointment %','Close rate %','Average customer value'],
 ['Contactable leads','Responses','Qualified / appointments','Scenario customers','Potential revenue scenario'],
 'Database x contactable % x response % x qualification % x close % x value','Never multiply the whole database by customer value and present it as recoverable revenue.'),
('05_no_show_roi','No-Show ROI','Use when missed appointments create lost revenue or wasted schedule capacity.',
 ['Appointments per month','Current no-show %','Scenario no-show %','Immediate appointment value','Optional downstream value'],
 ['Current no-shows','Scenario no-shows','Recovered appointments','Monthly revenue represented','Annual revenue represented'],
 'Appointments x (current no-show % - scenario no-show %) x appointment value','Prefer conservative first-appointment value unless downstream value is supported by client data.'),
('06_employee_capacity_roi','Employee Capacity ROI','Use when repetitive work consumes employee time that could shift to higher-value work.',
 ['Employees affected','Repetitive hours / employee / week','Loaded hourly labor cost','Addressable % of repetitive work','Productive weeks / year'],
 ['Annual repetitive hours','Addressable hours','Potential annual capacity value'],
 'Employees x hours/week x weeks x addressable % x loaded hourly cost','Capacity value is not automatic payroll savings. This form is never a justification to fire staff.'),
('07_sales_admin_capacity','Sales Administration Capacity','Use when sellers lose selling time to CRM entry, notes, proposals, scheduling, or reporting.',
 ['Salespeople affected','Admin hours / salesperson / week','Loaded hourly labor cost','Addressable %','Productive weeks / year'],
 ['Annual sales-admin hours','Recovered selling-hour scenario','Potential annual capacity value'],
 'Salespeople x admin hours/week x weeks x addressable % x loaded hourly cost','Frame the result as recovered selling capacity, not headcount reduction.'),
('08_overtime_reduction','Overtime Reduction','Use when repetitive or preventable workflow load is contributing to overtime.',
 ['Employees receiving overtime','OT hours / employee / week','Overtime hourly cost','OT tied to addressable workflow %','Scenario reduction %','Productive weeks / year'],
 ['Annual OT cost tied to workflow','Potential annual overtime value'],
 'Employees x OT hours x weeks x OT rate x workflow % x scenario reduction %','Only include overtime caused by the addressable workflow. Do not assume all overtime disappears.'),
('09_reporting_admin','Reporting / Admin Work ROI','Use for recurring reports, spreadsheet consolidation, and repeat administrative cycles.',
 ['Employees involved','Hours per cycle','Cycles per year','Loaded hourly labor cost','Addressable %'],
 ['Annual manual hours','Addressable hours','Potential annual capacity value'],
 'Employees x hours/cycle x cycles/year x addressable % x loaded hourly labor cost','Time recovered is capacity unless a real cost reduction is documented.'),
('10_document_processing','Document Processing ROI','Use for invoices, claims, applications, estimates, contracts, forms, or other repeat document work.',
 ['Documents per month','Minutes per document','Loaded hourly labor cost','Processing-time reduction scenario %'],
 ['Current monthly processing hours','Addressable monthly hours','Potential annual capacity value'],
 'Documents x minutes / 60 x reduction % x 12 x loaded hourly labor cost','Keep human review where legal, medical, financial, safety, or regulatory judgment is required.'),
('11_advertising_efficiency','Advertising Efficiency','Use when the business spends on ads but cannot clearly connect spend to qualified leads or customers.',
 ['Monthly ad spend','Monthly leads','Qualified leads','Customers acquired','Average customer revenue','Scenario cost / qualified lead'],
 ['Current CPL','Cost / qualified lead','Customer acquisition cost','Scenario qualified leads at same spend','Additional qualified lead scenario'],
 'Spend / leads; spend / qualified leads; spend / customers; compare scenario efficiency','Call suspected inefficiency "spend worth auditing" until an actual audit proves waste.'),
('12_hiring_deferral','Hiring Deferral / Capacity Planning','Use when growth is creating pressure to add administrative or support headcount.',
 ['Planned role / function','Annual compensation','Loaded-cost / burden estimate','Recruiting + onboarding cost','Workload driving the hire','Addressable workload %'],
 ['Estimated first-year loaded cost','Potential portion tied to addressable work','Capacity / deferral scenario'],
 'Loaded annual role cost + recruiting/onboarding; then evaluate addressable workload','This does not mean "replace a future employee." It tests whether better systems can delay unnecessary overhead.'),
('13_accounts_receivable','Accounts Receivable Efficiency','Use when employees manually chase receivables or collections follow-up is inconsistent.',
 ['Employees involved','AR follow-up hours / week','Loaded hourly labor cost','Addressable %','Outstanding receivables','Current DSO','Scenario DSO'],
 ['Annual AR labor hours','Potential annual capacity value','Potential working-capital improvement'],
 'Labor capacity: employees x hours x weeks x addressable % x hourly cost','Faster collection is working-capital improvement, not new revenue.'),
('14_final_roi_payback','Final ROI / Payback','Use only after the underlying opportunity calculations are defensible.',
 ['Conservative annual value','Expected annual value','Aggressive annual value','Implementation cost','Monthly ongoing cost','Annual ongoing cost if applicable'],
 ['First-year investment','Conservative net value / ROI','Expected net value / ROI','Aggressive net value / ROI','Estimated payback period'],
 'Net value = annual value - first-year investment; ROI = net value / investment; payback = investment / monthly value','All values are scenarios, not forecasts or guarantees. Do not force assumptions to make a project appear attractive.')]

def lines(text,font,size,width):
    out=[]; line=''
    for w in text.split():
        t=(line+' '+w).strip()
        if stringWidth(t,font,size)<=width: line=t
        else:
            if line: out.append(line)
            line=w
    if line: out.append(line)
    return out

def write(c,text,x,y,width,size=7.1,color=SLATE,max_lines=2):
    c.setFont('Helvetica',size); c.setFillColor(color)
    for ln in lines(text,'Helvetica',size,width)[:max_lines]: c.drawString(x,y,ln); y-=8.2

def field(c,name,x,y,w,h=.25*inch,size=8.2,multi=False):
    c.acroForm.textfield(name=name,x=x,y=y,width=w,height=h,borderWidth=1,borderColor=BORDER,fillColor=white,
        textColor=SLATE,forceBorder=True,fontName='Helvetica',fontSize=size,fieldFlags=4096 if multi else 0)

def make(spec):
    slug,title,use,inputs,outputs,formula,guard=spec; p=OUT/(slug+'.pdf'); c=canvas.Canvas(str(p),pagesize=letter)
    c.setFillColor(CLOUD); c.rect(0,0,W,H,fill=1,stroke=0); c.setFillColor(NAVY); c.rect(0,H-.78*inch,W,.78*inch,fill=1,stroke=0)
    c.setFillColor(CYAN); c.setFont('Helvetica-Bold',7.8); c.drawString(M,H-.25*inch,'YOUR AI DEPARTMENT')
    c.setFillColor(white); c.setFont('Helvetica-Bold',17); c.drawString(M,H-.53*inch,title); c.setFont('Helvetica',7.5); c.drawRightString(W-M,H-.50*inch,'FIELD ROI WORKSHEET')
    y=H-.98*inch; c.setFillColor(PALE_BLUE); c.roundRect(M,y-.37*inch,W-2*M,.37*inch,5,fill=1,stroke=0)
    c.setFillColor(BLUE); c.setFont('Helvetica-Bold',7.1); c.drawString(M+.10*inch,y-.14*inch,'WHEN TO USE'); write(c,use,M+.90*inch,y-.14*inch,W-2*M-1*inch); y-=.51*inch
    mw=(W-2*M-2*GAP)/3
    for i,(lab,sfx) in enumerate([('COMPANY','company'),('DATE','date'),('SALESPERSON','rep')]):
        x=M+i*(mw+GAP); c.setFillColor(GRAY); c.setFont('Helvetica-Bold',6.5); c.drawString(x,y,lab); field(c,slug+'_'+sfx,x,y-.29*inch,mw)
    y-=.48*inch; c.setFillColor(NAVY); c.setFont('Helvetica-Bold',9.5); c.drawString(M,y,'INPUTS'); c.setFillColor(GRAY); c.setFont('Helvetica',6.2); c.drawRightString(W-M,y,'Source: V=verified | C=client estimate | B=benchmark | A=assumption'); y-=.18*inch
    cw=(W-2*M-GAP)/2; rh=.54*inch
    for i,lab in enumerate(inputs):
        r=i//2; col=i%2; x=M+col*(cw+GAP); yy=y-r*rh; c.setFillColor(SLATE); c.setFont('Helvetica-Bold',6.7); ls=lines(lab,'Helvetica-Bold',6.7,cw-.42*inch); c.drawString(x,yy,ls[0]);
        if len(ls)>1: c.setFillColor(GRAY); c.setFont('Helvetica',6.2); c.drawString(x,yy-.10*inch,ls[1])
        fy=yy-.35*inch; sw=.33*inch; field(c,f'{slug}_in_{i+1}',x,fy,cw-sw-.06*inch); field(c,f'{slug}_src_{i+1}',x+cw-sw,fy,sw,size=7.5)
    y-=math.ceil(len(inputs)/2)*rh+.02*inch; c.setFillColor(PALE_GRAY); c.roundRect(M,y-.36*inch,W-2*M,.36*inch,4,fill=1,stroke=0); c.setFillColor(NAVY); c.setFont('Helvetica-Bold',6.8); c.drawString(M+.10*inch,y-.14*inch,'CORE LOGIC'); write(c,formula,M+.80*inch,y-.14*inch,W-2*M-.90*inch,size=6.8); y-=.50*inch
    c.setFillColor(NAVY); c.setFont('Helvetica-Bold',9.5); c.drawString(M,y,'OUTPUTS / DISCUSSED SCENARIO'); y-=.18*inch; ow=(W-2*M-GAP)/2; orh=.53*inch
    for i,lab in enumerate(outputs):
        r=i//2; col=i%2; x=M+col*(ow+GAP); yy=y-r*orh; c.setFillColor(white); c.roundRect(x,yy-.40*inch,ow,.40*inch,4,fill=1,stroke=0); c.setFillColor(GRAY); c.setFont('Helvetica-Bold',6.3); ls=lines(lab,'Helvetica-Bold',6.3,ow-.18*inch); c.drawString(x+.08*inch,yy-.12*inch,ls[0]);
        if len(ls)>1: c.setFont('Helvetica',5.9); c.drawString(x+.08*inch,yy-.21*inch,ls[1])
        field(c,f'{slug}_out_{i+1}',x+.08*inch,yy-.35*inch,ow-.16*inch,h=.16*inch,size=7.4)
    y-=math.ceil(len(outputs)/2)*orh+.02*inch; c.setFillColor(NAVY); c.setFont('Helvetica-Bold',9.5); c.drawString(M,y,'VERIFY / NEXT STEP'); y-=.17*inch; nw=(W-2*M-GAP)/2; c.setFillColor(GRAY); c.setFont('Helvetica-Bold',6.4); c.drawString(M,y,'Missing data / verification needed'); c.drawString(M+nw+GAP,y,'Recommended next action'); field(c,slug+'_verify',M,y-.38*inch,nw,h=.31*inch,size=7.4,multi=True); field(c,slug+'_next',M+nw+GAP,y-.38*inch,nw,h=.31*inch,size=7.4,multi=True); y-=.52*inch
    c.setFillColor(PALE_GREEN); c.roundRect(M,y-.50*inch,W-2*M,.50*inch,5,fill=1,stroke=0); c.setFillColor(EMERALD); c.setFont('Helvetica-Bold',6.6); c.drawString(M+.10*inch,y-.14*inch,'YAD CLAIM DISCIPLINE'); write(c,guard,M+1.22*inch,y-.14*inch,W-2*M-1.32*inch,size=6.5,max_lines=3); c.setFillColor(MUTED); c.setFont('Helvetica',5.9); c.drawString(M,.21*inch,'Scenario estimate only - not guaranteed revenue, savings, or ROI.'); c.drawRightString(W-M,.21*inch,'YourAIDepartment.ai'); c.save(); return p

files=[make(x) for x in F]
w=PdfWriter()
for p in files:
    r=PdfReader(str(p)); assert len(r.pages)==1, p; w.append(r)
with open(OUT/'YAD_ROI_Forms_One_Page_Pack.pdf','wb') as fp: w.write(fp)
print('Generated',len(files),'one-page forms and combined pack')
