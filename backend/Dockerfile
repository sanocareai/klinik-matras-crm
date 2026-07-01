FROM node:20-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

EXPOSE 4000
CMD ["node", "src/index.js"]
