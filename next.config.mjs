/** @type {import('next').NextConfig} */
const nextConfig = {
  logging: {
    // Server Action の引数（authorId と本文）がログに出ると、そこから送信者が分かってしまうため
    serverFunctions: false,
  },
};
export default nextConfig;
