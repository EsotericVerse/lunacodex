import {LOC_SERVICE_ORIGINS} from './app/modular/routing/service-route-index.mjs';

// Vercel assigns a unique deployment ID at build time. Next.js requires
// its deploymentId value not to start with "dpl_", so strip that provider
// prefix while preserving uniqueness for every Vercel deployment. Cloudflare
// continues to use its existing build UUID / commit SHA precedence.
const vercelDeploymentId = process.env.VERCEL_DEPLOYMENT_ID
  ?.replace(/^dpl_/, '');

const deploymentId = process.env.NEXT_DEPLOYMENT_ID
  || vercelDeploymentId
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
