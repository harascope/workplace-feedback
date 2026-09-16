/** @type {import('next').NextConfig} */
const nextConfig = {
  // 本番は .next/standalone を単体で動かす（Dockerfile の runner 段）
  output: "standalone",
  logging: {
    // Server Action の引数（authorId と本文）がログに出ると、そこから送信者が分かってしまうため
    serverFunctions: false,
  },
};
export default nextConfig;
