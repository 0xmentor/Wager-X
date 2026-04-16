FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json next.config.mjs ./
RUN npm install
COPY app ./app
COPY lib ./lib
COPY next-env.d.ts ./
EXPOSE 3000
CMD ["npm", "run", "dev"]
