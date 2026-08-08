# VRENT Memory XR — multiplayer server
#
# Build context is the app root (the directory holding `server/` and
# `shared/`), because the server imports the shared rules directly:
#
#   docker build -f server/Dockerfile -t vrent-memory-server .
#   docker run -p 8787:8787 -v vrent-data:/data vrent-memory-server
#
# There is no build step. Node 22 strips the TypeScript types at load time,
# which is also how the server runs in development — one less thing to differ
# between the machine it worked on and the machine it has to work on.

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app

# Dependencies first: this layer only rebuilds when the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The server and the rules it shares with the headset.
COPY server ./server
COPY shared ./shared

# The leaderboard volume. Owned by `node` so the unprivileged process can
# write it; a volume mounted over this path may arrive root-owned, in which
# case the server logs `leaderboard.readonly` and keeps playing from memory
# until you chown it (see README).
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8787

# `fetch` is built in, so no curl in the image just to answer one question.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "server/index.ts"]
