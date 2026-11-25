import {LOC_SERVICE_ORIGINS} from './app/modular/routing/service-route-index.mjs';

const deploymentId = process.env.NEXT_DEPLOYMENT_ID
  || process.env.WORKERS_CI_BUILD_UUID
  || process.env.WORKERS_CI_COMMIT_SHA
  || process.env.GITHUB_SHA
  || 'loc-development';

const nextConfig = {
  deploymentId,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // LRS owns the full card namespace. Web requests leave LOC before rendering.
  ...(process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'?{}:{
    async redirects(){
      return [
        ...['/card/:path*','/lrunes/card/:path*'].map(source=>[source,'/card/:path*']),
        ...['/daily/:path*','/lrunes/daily/:path*'].map(source=>[source,'/card/daily/:path*']),
        ...['/game/:path*','/lrunes/game/:path*'].map(source=>[source,'/game/:path*'])
      ].map(([source,path])=>({source,destination:LOC_SERVICE_ORIGINS.lrs+path,permanent:false}));
    }
  })
};

export default nextConfig;
