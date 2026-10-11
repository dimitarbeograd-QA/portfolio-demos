"""Resample Copernicus DEM GLO-30 (open data on AWS) to the 30 m local grid used by the page."""
import rasterio, numpy as np, math, base64
from rasterio.windows import from_bounds
from scipy.ndimage import map_coordinates, gaussian_filter
U='https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N43_00_E023_00_DEM/Copernicus_DSM_COG_10_N43_00_E023_00_DEM.tif'
LAT0,LON0=43.8167,23.2333; KX=111320*math.cos(math.radians(LAT0)); KY=110574
with rasterio.open(U) as d:
    w=from_bounds(LON0-4600/KX,LAT0-5100/KY,LON0+4600/KX,LAT0+5100/KY,d.transform); a=d.read(1,window=w)
lon0=LON0-4600/KX; lat1=LAT0+5100/KY; res=1/3600
xs=np.arange(-4500,4501,30); ys=np.arange(-5100,5101,30); XX,YY=np.meshgrid(xs,ys)
col=((LON0+XX/KX)-lon0)/res-0.5; row=(lat1-(LAT0+YY/KY))/res-0.5
h=gaussian_filter(map_coordinates(a.astype(float),[row,col],order=1,mode='nearest'),1.0)
q=np.clip(np.round((h-23.0)/0.75),0,255).astype(np.uint8)
open('dem.b64','w').write(base64.b64encode(q.tobytes()).decode())
