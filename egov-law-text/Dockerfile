FROM apify/actor-node:22
COPY package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --omit=optional --no-audit --no-fund && (npm list --omit=dev --all || true)
COPY . ./
CMD npm start --silent
