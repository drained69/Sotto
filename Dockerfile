FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Production is Mainnet-only; this profile includes the reviewed Vesu vault
# allowlist and takes the deployed helper from the public build environment.
RUN VITE_VESU_LENDING_HELPER_ADDRESS=0x06277c357edf60e9acbbd5a9efaeb8fcb0d0b0daf1f06801ed94d4247a9b1e6a npm run build:mainnet

FROM caddy:2.10.0-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
