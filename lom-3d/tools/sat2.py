import numpy as np, math, rasterio, base64
from rasterio.windows import Window
from pyproj import Transformer
from PIL import Image
URL="https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/FP/2025/7/S2C_34TFP_20250726_0_L2A/TCI.tif"
LAT0,LON0=43.8167,23.2333
KX=111320*math.cos(math.radians(LAT0));KY=110574.0
X0,X1,Y0,Y1=-4000,4000,-4600,4600
W,H=1400,1610
xs=X0+(np.arange(W)+.5)*(X1-X0)/W
ys=Y1-(np.arange(H)+.5)*(Y1-Y0)/H
gx,gy=np.meshgrid(xs,ys)
t=Transformer.from_crs(4326,32634,always_xy=True)
E,N=t.transform(LON0+gx/KX,LAT0+gy/KY)
with rasterio.open(URL) as ds:
    c,r=~ds.transform*(E,N)
    c0,c1=max(0,int(c.min())-2),min(ds.width,int(c.max())+3); r0,r1=max(0,int(r.min())-2),min(ds.height,int(r.max())+3)
    a=ds.read(window=Window(c0,r0,c1-c0,r1-r0))
    print(a.shape)
c-=c0+.5; r-=r0+.5
ci=np.clip(np.floor(c).astype(int),0,a.shape[2]-2);ri=np.clip(np.floor(r).astype(int),0,a.shape[1]-2)
fc=(c-ci)[...,None];fr=(r-ri)[...,None]
a=a.transpose(1,2,0).astype(float)
o=(a[ri,ci]*(1-fc)*(1-fr)+a[ri,ci+1]*fc*(1-fr)+a[ri+1,ci]*(1-fc)*fr+a[ri+1,ci+1]*fc*fr)

# water recolour from NDWI (green vs near-infrared); the true-colour water is dark green and reads as forest
def band(name):
    u=URL.replace('TCI.tif',name)
    with rasterio.open(u) as d2:
        w=d2.read(1,window=Window(c0,r0,c1-c0,r1-r0)).astype(float)
    return (w[ri,ci]*(1-fc[...,0])*(1-fr[...,0])+w[ri,ci+1]*fc[...,0]*(1-fr[...,0])+w[ri+1,ci]*(1-fc[...,0])*fr[...,0]+w[ri+1,ci+1]*fc[...,0]*fr[...,0])
B3=band('B03.tif'); B8=band('B08.tif')
ndwi=(B3-B8)/(B3+B8+1e-6)
from PIL import ImageFilter
wm=np.array(Image.fromarray((np.clip((ndwi-0.05)/0.2,0,1)*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)),dtype=float)/255
lum=o.mean(axis=2,keepdims=True)
blue=np.concatenate([lum*0.55+14,lum*0.95+38,lum*1.05+62],axis=2)
o=o*(1-wm[...,None])+blue*wm[...,None]
print('water fraction',round(float((wm>0.5).mean()),3))
# add fine grain so close-ups are not plastic (decorative; strongest on vegetation)
rng=np.random.default_rng(7)
def noise(scale):
    n=rng.standard_normal((H//scale+2,W//scale+2))
    return np.array(Image.fromarray(n.astype('float32')).resize((W,H),Image.BICUBIC))
nz=0.5*noise(1)+0.8*noise(3)+0.8*noise(8)
green=((o[...,1]>o[...,0]*1.03)&(o[...,1]>o[...,2]*1.1)).astype(float)
amp=3.5+5.5*green
o2=np.clip(o+(nz*amp)[...,None]*np.array([0.9,1.0,0.8]),0,255)
# sharpen (unsharp mask) and a little more local contrast/saturation so the 10 m imagery reads crisper
from PIL import ImageEnhance
im=Image.fromarray(o2.astype('uint8'))
im=im.filter(ImageFilter.UnsharpMask(radius=2.2,percent=170,threshold=2))
im=ImageEnhance.Color(im).enhance(1.12); im=ImageEnhance.Contrast(im).enhance(1.06)
im.save('sat.jpg',quality=82)
# water mask for the crisp procedural water layer
Image.fromarray((np.clip((wm-0.05)/0.9,0,1)*255).astype('uint8')).save('water_mask.png',optimize=True)
np.save('wm.npy',wm)
print('sat.jpg',__import__('os').path.getsize('sat.jpg')//1024,'KB')
# vegetation bit mask, 10 m cells over bounds -2500..2500, -2900..2900
mx=np.arange(500)*10-2500+5; my=2900-(np.arange(580)*10+5)
jj=np.clip(((mx-X0)/((X1-X0)/W)).astype(int),0,W-1); ii=np.clip(((Y1-my)/((Y1-Y0)/H)).astype(int),0,H-1)
sub=o[np.ix_(ii,jj)]; wsub=wm[np.ix_(ii,jj)]
m=((sub[...,1]>sub[...,0]*1.03)&(sub[...,1]>sub[...,2]*1.1)&(sub[...,1]<190)&(wsub<0.3)).astype(np.uint8)
print('green fraction',m.mean())
Image.fromarray((m*255).astype('uint8')).save('mask_preview.png')
bits=np.packbits(m.flatten())
open('veg.b64','w').write(base64.b64encode(bits.tobytes()).decode())
print('mask b64',len(open('veg.b64').read())//1024,'KB')
# edge average colour for the surrounding plane
edge=np.concatenate([o[0],o[-1],o[:,0],o[:,-1]]).mean(0); print('edge',edge.astype(int))
