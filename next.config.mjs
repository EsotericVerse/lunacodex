const nextConfig = {
  ...(process.env.LOC_STATIC_EXPORT==='1'?{output:'export'}:{}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true
};

export default nextConfig;
