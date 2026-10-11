import numpy as np, math, rasterio
from rasterio.windows import Window
from pyproj import Transformer
from scipy.ndimage import map_coordinates, label
from PIL import Image
URL="https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/FP/2025/7/S2C_34TFP_20250726_0_L2A/"
LAT0,LON0=43.8167,23.2333
KX=111320*math.cos(math.radians(LAT0));KY=110574.0
X0,X1,Y0,Y1=-4000,4000,-4600,4600
STEP=3.0
W=int((X1-X0)/STEP); H=int((Y1-Y0)/STEP)
xs=X0+(np.arange(W)+.5)*STEP; ys=Y1-(np.arange(H)+.5)*STEP
t=Transformer.from_crs(4326,32634,always_xy=True)
# window over the full area
cs=[(X0,Y0),(X1,Y0),(X0,Y1),(X1,Y1)]
E,N=zip(*[t.transform(LON0+x/KX,LAT0+y/KY) for x,y in cs])
with rasterio.open(URL+"B03.tif") as d:
    ca,rb=~d.transform*(min(E),min(N)); cb,ra=~d.transform*(max(E),max(N))
    c0,c1,r0,r1=int(ca)-6,int(cb)+7,int(ra)-6,int(rb)+7
    g=d.read(1,window=Window(c0,r0,c1-c0,r1-r0)).astype('float32')
    tr=d.transform
with rasterio.open(URL+"B08.tif") as d:
    n=d.read(1,window=Window(c0,r0,c1-c0,r1-r0)).astype('float32')
ndwi=(g-n)/(g+n+1e-6)
out=np.zeros((H,W),'float32')
for i0 in range(0,H,512):
    gx,gy=np.meshgrid(xs,ys[i0:i0+512])
    Eg,Ng=t.transform(LON0+gx/KX,LAT0+gy/KY)
    cc,rr=~tr*(Eg,Ng); cc=cc-c0-.5; rr=rr-r0-.5
    out[i0:i0+512]=map_coordinates(ndwi,[rr,cc],order=3,mode='nearest')
np.save('ndwi_hi.npy',out.astype('float16'))
lo,hi=0.02,0.09
m=np.clip((out-lo)/(hi-lo),0,1); m=m*m*(3-2*m)
# drop tiny specks (<= ~150 m2) so shadows/roofs do not become ponds
lab,k=label(m>0.5); sz=np.bincount(lab.ravel()); small=(sz<18); small[0]=False
m[small[lab]]=0
# fill tiny holes inside water
lab2,k2=label(m<0.5); sz2=np.bincount(lab2.ravel()); sm2=(sz2<18); sm2[0]=False
m[sm2[lab2]&(m<0.5)]=1
print('water frac',round(float((m>0.5).mean()),3),W,H)
Image.fromarray((m*255).astype('uint8')).save('water_mask_hi.png',optimize=True)
import os;print(os.path.getsize('water_mask_hi.png')//1024,'KB')
