#!/usr/bin/env python3
"""Draws the kart circuit design sheet (docs/circuits/kart-circuit-design.svg) from a list of centreline control points (metres)."""
import math, sys
PTS = [(30,30),(110,28),(170,28),(198,33),(213,54),(212,76),(221,92),(214,108),(204,123),(184,128),(150,124),(128,116),(110,124),(86,128),(64,122),(52,110),(60,98),(90,94),(122,92),(144,80),(150,66),(136,54),(114,54),(96,62),(84,70),(56,70),(32,62),(20,46),(24,34)]
W = 8.0; S = 6.0; OX, OY = 70, 150
def cr(p0,p1,p2,p3,n=24):
    t0=0; t1=math.hypot(p1[0]-p0[0],p1[1]-p0[1])**0.5; t2=t1+math.hypot(p2[0]-p1[0],p2[1]-p1[1])**0.5; t3=t2+math.hypot(p3[0]-p2[0],p3[1]-p2[1])**0.5
    out=[]
    for i in range(n):
        u=t1+(t2-t1)*i/n
        def L(a,b,ta,tb): return tuple(((tb-u)*a[k]+(u-ta)*b[k])/(tb-ta) for k in (0,1))
        A1=L(p0,p1,t0,t1);A2=L(p1,p2,t1,t2);A3=L(p2,p3,t2,t3);B1=L(A1,A2,t0,t2);B2=L(A2,A3,t1,t3)
        out.append(L(B1,B2,t1,t2))
    return out
def build():
    n=len(PTS); c=[]
    for i in range(n): c+=cr(PTS[(i-1)%n],PTS[i],PTS[(i+1)%n],PTS[(i+2)%n])
    # resample to even 2 m
    out=[c[0]];acc=0
    pts=c+[c[0]]
    for i in range(1,len(pts)):
        a,b=pts[i-1],pts[i];seg=math.hypot(b[0]-a[0],b[1]-a[1]);t=0
        while acc+seg-t>=2.0 and seg>0:
            t+=2.0-acc;acc=0;out.append((a[0]+(b[0]-a[0])*t/seg,a[1]+(b[1]-a[1])*t/seg))
        acc+=seg-t
    return out
C=build(); N=len(C)
def tan(i): a,b=C[(i-1)%N],C[(i+1)%N];l=math.hypot(b[0]-a[0],b[1]-a[1]);return ((b[0]-a[0])/l,(b[1]-a[1])/l)
def off(i,d): t=tan(i);return (C[i][0]-t[1]*d,C[i][1]+t[0]*d)
def curv(i,k=5):
    a,b,c=C[(i-k)%N],C[i],C[(i+k)%N];ab=math.hypot(b[0]-a[0],b[1]-a[1]);bc=math.hypot(c[0]-b[0],c[1]-b[1]);ca=math.hypot(a[0]-c[0],a[1]-c[1])
    cr_=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);return 2*cr_/max(1e-6,ab*bc*ca)
L=N*2.0; S0=30
# closest approach between non-adjacent parts
gap=1e9
for i in range(0,N,2):
    for j in range(i+int(40/2),N,2):
        if min(j-i,N-(j-i))*2<40: continue
        gap=min(gap,math.hypot(C[i][0]-C[j][0],C[i][1]-C[j][1]))
R=min(1/abs(curv(i)) for i in range(N) if abs(curv(i))>1e-6)
print('length %.0f m, tightest radius %.1f m, closest approach %.1f m'%(L,R,gap),file=sys.stderr)
P=lambda p:(OX+p[0]*S,OY+p[1]*S)
def path(idx,off_d=0,close=False):
    pts=[P(off(i%N,off_d) if off_d else C[i%N]) for i in idx]
    return 'M'+' L'.join('%.1f,%.1f'%q for q in pts)+(' Z' if close else '')
# corners: local curvature peaks
sgn=lambda x:1 if x>0 else -1
cs=[abs(curv(i,6)) for i in range(N)]
corners=[]
for i in range(N):
    if cs[i]>1/85 and all(cs[i]>=cs[(i+d)%N] for d in range(-10,11)):
        corners.append(i)
# renumber starting after the line (index 0 = start/finish)
corners.sort()
names={}
svg=[]
add=svg.append
add('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" font-family="Helvetica, Arial, sans-serif">')
add('<defs><pattern id="chk" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#111"/><rect x="6" y="6" width="6" height="6" fill="#111"/><rect x="6" width="6" height="6" fill="#fff"/><rect y="6" width="6" height="6" fill="#fff"/></pattern>')
add('<pattern id="stripe" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(0)"><rect width="40" height="20" fill="#5c9a46"/><rect y="20" width="40" height="20" fill="#559340"/></pattern></defs>')
add('<rect width="1600" height="1000" fill="url(#stripe)"/>')
allidx=list(range(N))
# runoff, tarmac
add('<path d="%s" fill="none" stroke="#8c9096" stroke-width="%.1f" stroke-linejoin="round" stroke-linecap="round"/>'%(path(allidx,0,True),(W+10)*S))
add('<path d="%s" fill="none" stroke="#e8e8e8" stroke-width="%.1f" stroke-linejoin="round"/>'%(path(allidx,0,True),(W+0.7)*S))
add('<path d="%s" fill="none" stroke="#33363b" stroke-width="%.1f" stroke-linejoin="round"/>'%(path(allidx,0,True),W*S))
add('<path d="%s" fill="none" stroke="#4a4e55" stroke-width="%.1f" stroke-dasharray="3 6" opacity=".5"/>'%(path(allidx,0,True),W*0.35*S))
# kerbs on the inside of each corner
for ci in corners:
    d=sgn(curv(ci,6))
    span=range(ci-14,ci+15)
    for sidew in (d,):
        for col,dash,gapd in (('#d32f2f','8 8',0),('#ffffff','8 8',8)):
            add('<path d="%s" fill="none" stroke="%s" stroke-width="%.1f" stroke-dasharray="%s" stroke-dashoffset="%d"/>'%(path(span,sidew*(W/2+0.45)),col,1.6*S/1.6,dash,gapd))
# pit lane parallel to the main straight (inside, right side of travel is +? use offset sign by curvature of the whole lap)
area=sum(C[i][0]*C[(i+1)%N][1]-C[(i+1)%N][0]*C[i][1] for i in range(N))/2
inside=1 if area>0 else -1
pit=range(S0-14,S0+48)
add('<path d="%s" fill="none" stroke="#e8e8e8" stroke-width="%.1f"/>'%(path(pit,-inside*-(W/2+3.2)),4.5*S))
add('<path d="%s" fill="none" stroke="#5a5e66" stroke-width="%.1f"/>'%(path(pit,-inside*-(W/2+3.2)),4.1*S))
for k in range(S0-10,S0+44,5):
    q=off(k,-inside*-(W/2+8.6));t=tan(k);ang=math.degrees(math.atan2(t[1],t[0]));x,y=P(q)
    add('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#cfd2d6" stroke="#6d7076" stroke-width="1" transform="rotate(%.1f %.1f %.1f)"/>'%(x-4.4*S,y-1.4*S,8.8*S,2.8*S,ang,x,y))
# grid boxes behind the line
for g in range(10):
    i=(S0-5-g*3)%N; side=(-1)**g*0.22*W
    x,y=P(off(i,side));t=tan(i);ang=math.degrees(math.atan2(t[1],t[0]))
    add('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="none" stroke="#fff" stroke-width="2" transform="rotate(%.1f %.1f %.1f)"/>'%(x-1.0*S,y-0.5*S,2.0*S,1.0*S,ang,x,y))
# start/finish chequer
x,y=P(C[S0]);t=tan(S0);ang=math.degrees(math.atan2(t[1],t[0]))
add('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="url(#chk)" stroke="#fff" stroke-width="1" transform="rotate(%.1f %.1f %.1f)"/>'%(x-0.9*S,y-W*S/2,1.8*S,W*S,ang,x,y))
# tyre walls on the outside of corners
for ci in corners:
    d=sgn(curv(ci,6))
    add('<path d="%s" fill="none" stroke="#1d2a3a" stroke-width="%.1f" stroke-dasharray="7 3" stroke-linecap="round"/>'%(path(range(ci-16,ci+17),-d*(W/2+7.2)),1.9*S))
# sector lines
for k,(frac,col) in enumerate(((0.33,'#1e88e5'),(0.66,'#fdd835'))):
    i=(S0+int(N*frac))%N;x,y=P(C[i]);t=tan(i);ang=math.degrees(math.atan2(t[1],t[0]))
    add('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" transform="rotate(%.1f %.1f %.1f)"/>'%(x-0.4*S,y-W*S/2,0.8*S,W*S,col,ang,x,y))
    ox,oy=P(off(i,inside*(W/2+9)))
    add('<text x="%.1f" y="%.1f" font-size="22" font-weight="700" fill="%s" stroke="#111" stroke-width=".8" text-anchor="middle">S%d</text>'%(ox,oy,col,k+2))
# direction arrows
for i in range(S0+20,N+S0,60):
    i%=N;x,y=P(C[i]);t=tan(i);ang=math.degrees(math.atan2(t[1],t[0]))
    add('<path d="M-10,-8 L8,0 L-10,8 Z" fill="#fff" opacity=".9" transform="translate(%.1f %.1f) rotate(%.1f)"/>'%(x,y,ang))
# corner labels
for n,ci in enumerate(sorted(corners,key=lambda c:(c-S0)%N)):
    d=sgn(curv(ci,6)); q=off(ci,-d*(W/2+14.5)); x,y=P(q)
    names[ci]=n+1
    add('<circle cx="%.1f" cy="%.1f" r="17" fill="#fff" stroke="#111" stroke-width="2.5"/><text x="%.1f" y="%.1f" font-size="21" font-weight="700" fill="#111" text-anchor="middle">%d</text>'%(x,y,x,y+7.5,n+1))
# title block
tx,ty=1080,14
add('<rect x="%d" y="%d" width="490" height="204" rx="10" fill="#101418" opacity=".92"/>'%(tx,ty))
add('<text x="%d" y="%d" font-size="34" font-weight="700" fill="#fff">APEX RING</text>'%(tx+22,ty+46))
add('<text x="%d" y="%d" font-size="18" fill="#ffc400" letter-spacing="3">KARTING CIRCUIT · DESIGN</text>'%(tx+22,ty+74))
for k,(a,b) in enumerate((('Length','%d m'%round(L,-1)),('Track width','8 m (10 m on the pit straight)'),('Corners','%d numbered'%len(corners)),('Tightest corner','%d m radius'%round(R)),('Direction','as the white arrows'))):
    add('<text x="%d" y="%d" font-size="17" fill="#9aa4ae">%s</text><text x="%d" y="%d" font-size="17" fill="#fff">%s</text>'%(tx+22,ty+106+k*20,a,tx+150,ty+106+k*20,b))
# scale bar and north
sx,sy=70,950
add('<rect x="%d" y="%d" width="%.1f" height="9" fill="#fff" stroke="#111"/><rect x="%.1f" y="%d" width="%.1f" height="9" fill="#111"/>'%(sx,sy,25*S,sx+25*S,sy,25*S))
add('<text x="%d" y="%d" font-size="16" fill="#fff" stroke="#111" stroke-width=".6">0</text><text x="%.1f" y="%d" font-size="16" fill="#fff" stroke="#111" stroke-width=".6" text-anchor="middle">25</text><text x="%.1f" y="%d" font-size="16" fill="#fff" stroke="#111" stroke-width=".6" text-anchor="middle">50 m</text>'%(sx-4,sy-8,sx+25*S,sy-8,sx+50*S,sy-8))

def lab(i,d,txt,col='#fff',size=17):
    x,y=P(off(i%N,d)); add('<text x="%.1f" y="%.1f" font-size="%d" font-weight="700" fill="%s" stroke="#111" stroke-width=".7" paint-order="stroke" text-anchor="middle" letter-spacing="1.5">%s</text>'%(x,y,size,col,txt))
lab(S0+22,inside*(W/2+3.2)+0.2,'PIT LANE',size=13); lab(S0,-inside*(W/2+4.2),'START / FINISH',col='#ffc400',size=15)
lx,ly=70,60
add('<rect x="%d" y="%d" width="360" height="150" rx="10" fill="#101418" opacity=".92"/>'%(lx-20,ly-30))
for k,(kind,txt) in enumerate((('kerb','Kerbs on the inside of each corner'),('wall','Tyre walls on the outside'),('grid','Grid boxes, staggered, 10 karts'),('s1','Sector lines S2 and S3'),('pit','Pit lane and garages on the infield side'))):
    yy=ly+k*24-8
    if kind=='kerb': add('<rect x="%d" y="%d" width="40" height="8" fill="#d32f2f"/><rect x="%d" y="%d" width="20" height="8" fill="#fff"/>'%(lx,yy,lx+20,yy))
    if kind=='wall': add('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#2c3e55" stroke-width="9" stroke-dasharray="7 3" stroke-linecap="round"/>'%(lx,yy+4,lx+40,yy+4))
    if kind=='grid': add('<rect x="%d" y="%d" width="22" height="11" fill="none" stroke="#fff" stroke-width="2"/>'%(lx+8,yy))
    if kind=='s1': add('<rect x="%d" y="%d" width="5" height="14" fill="#1e88e5"/><rect x="%d" y="%d" width="5" height="14" fill="#fdd835"/>'%(lx+12,yy-2,lx+24,yy-2))
    if kind=='pit': add('<rect x="%d" y="%d" width="40" height="12" fill="#cfd2d6" stroke="#6d7076"/>'%(lx,yy-1))
    add('<text x="%d" y="%d" font-size="16" fill="#fff">%s</text>'%(lx+56,yy+10,txt))

# export the centreline as a game map module: world X = -east, Z = north (design y is south), index 0 = start line, ~4 m spacing
if '--track' in sys.argv:
    out=sys.argv[sys.argv.index('--track')+1]
    pts=[C[(S0+k)%N] for k in range(0,N,2)]
    cx=(max(p[0] for p in pts)+min(p[0] for p in pts))/2; cz=(max(p[1] for p in pts)+min(p[1] for p in pts))/2
    w=[(-(x-cx),-(y-cz)) for x,y in pts]
    L2=sum(math.hypot(w[(i+1)%len(w)][0]-w[i][0],w[(i+1)%len(w)][1]-w[i][1]) for i in range(len(w)))
    cd=sorted(((c-S0)%N*2.0 for c in corners))
    with open(out,'w') as f:
        f.write('// Generated by tools/design-kart-circuit.py --track from the Apex Ring design sheet - do not edit by hand.\n')
        f.write('export const LENGTH = %.1f;   // m, start/finish is point 0\nexport const CORNER_DISTANCES = [%s];   // lap distance of each numbered corner\n'%(L2,', '.join('%.0f'%d for d in cd)))
        f.write('export const CENTERLINE = [\n'+',\n'.join('  [%.2f, %.2f]'%q for q in w)+',\n];\n')
    print('wrote',out,len(w),'points, length %.1f'%L2,file=sys.stderr)
    sys.exit(0)
open(sys.argv[1] if len(sys.argv)>1 else 'docs/circuits/kart-circuit-design.svg','w').write('\n'.join(svg+['</svg>']))
