import numpy as np, math, rasterio
from pyproj import Transformer
from PIL import Image
URL="https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/FP/2025/7/S2C_34TFP_20250726_0_L2A/B02.tif"
LAT0,LON0=43.8167,23.2333
KX=111320*math.cos(math.radians(LAT0));KY=110574.0
t=Transformer.from_crs(4326,32634,always_xy=True)
H=1500
E,N=zip(*[t.transform(LON0+x/KX,LAT0+y/KY) for x,y in [(-H,-H),(H,-H),(-H,H),(H,H)]])
with rasterio.open(URL) as ds:
    c0,r1=~ds.transform*(min(E),min(N)); c1,r0=~ds.transform*(max(E),max(N))
    c0,c1,r0,r1=int(c0)-8,int(c1)+8,int(r0)-8,int(r1)+8
    print(c1-c0,r1-r0)
    Etl,Ntl=ds.transform*(c0+34,r0+34)
print(Etl,Ntl)
sr=np.asarray(Image.open('lom_sr.png').convert('RGB')).astype(float)
S=960; R=1200.0
xs=-R+(np.arange(S)+.5)*2*R/S; ys=R-(np.arange(S)+.5)*2*R/S
gx,gy=np.meshgrid(xs,ys)
Eg,Ng=t.transform(LON0+gx/KX,LAT0+gy/KY)
cc=(Eg-Etl)/2.5-.5; rr=(Ntl-Ng)/2.5-.5
print(cc.min(),cc.max(),rr.min(),rr.max())
ci=np.clip(np.floor(cc).astype(int),0,1022);ri=np.clip(np.floor(rr).astype(int),0,1022)
fc=(cc-ci)[...,None];fr=(rr-ri)[...,None]
o=sr[ri,ci]*(1-fc)*(1-fr)+sr[ri,ci+1]*fc*(1-fr)+sr[ri+1,ci]*(1-fc)*fr+sr[ri+1,ci+1]*fc*fr
Image.fromarray(o.clip(0,255).astype('uint8')).save('sr_local.jpg',quality=88)
import os;print(os.path.getsize('sr_local.jpg')//1024,'KB')
