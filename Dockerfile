FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
