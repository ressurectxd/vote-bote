FROM node:20-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --immutable

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_FILE=/app/data/db.json

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --immutable

COPY --from=build /app/dist ./dist

CMD ["yarn", "start"]
