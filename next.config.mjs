const deploymentId = process.env.NEXT_DEPLOYMENT_ID
  || process.env.WORKERS_CI_BUILD_UUID
  || process.env.WORKERS_CI_COMMIT_SHA
  || process.env.GITHUB_SHA
  || 'loc-development';

const nextConfig = {
  deploymentId,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true
};

export default nextConfig;
