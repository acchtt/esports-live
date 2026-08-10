FROM node:24-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY detector.mjs frame-source.mjs server.mjs ./

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080
CMD ["node", "server.mjs"]
