const nextConfig = {
  ...(process.env.LOC_STATIC_EXPORT==='1'?{output:'export'}:{}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: { NEXT_PUBLIC_LRS_ASSET_ORIGIN: process.env.NEXT_PUBLIC_LRS_ASSET_ORIGIN || 'https://lrs.lo3rwang.cc' }
};

export default nextConfig;
