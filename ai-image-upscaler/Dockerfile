# Debian (glibc) base: onnxruntime-node ships glibc binaries only, so the usual Alpine Actor image would not work.
FROM node:22-bookworm-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . ./
CMD ["npm", "start", "--silent"]
