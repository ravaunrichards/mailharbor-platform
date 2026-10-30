FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/src ./src
COPY database /database
COPY frontend /frontend

ENV PORT=3000
EXPOSE 3000

USER node
CMD ["npm", "start"]