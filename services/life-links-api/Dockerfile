# Build context is the existing standalone Life Links public projection, not
# the monorepo. This replaces the implicit Nixpacks processor environment.
FROM --platform=linux/amd64 node@sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac AS native
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    build-essential=12.9 cmake=3.25.1-1 pkg-config xz-utils ca-certificates curl zlib1g-dev=1:1.2.13.dfsg-1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/source
RUN curl --fail --location --proto '=https' --tlsv1.2 \
      https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz -o ffmpeg.tar.xz \
    && echo 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635  ffmpeg.tar.xz' | sha256sum -c - \
    && tar -xf ffmpeg.tar.xz && cd ffmpeg-9.0.1 \
    && ./configure --prefix=/opt/life-links --disable-doc --disable-debug --disable-ffplay \
      --disable-network --disable-autodetect --disable-x86asm --disable-shared --enable-static --enable-zlib \
    && make -j4 && make install \
    && mkdir -p /opt/life-links/licenses /opt/life-links/source \
    && cp COPYING.LGPLv2.1 /opt/life-links/licenses/FFmpeg-LGPL-2.1.txt \
    && cp ../ffmpeg.tar.xz /opt/life-links/source/ffmpeg-9.0.1.tar.xz
RUN curl --fail --location --proto '=https' --tlsv1.2 \
      https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/23ee03506a91ac3d3f0071b40e66a430eebdfa1d -o whisper.tar.gz \
    && echo 'c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032  whisper.tar.gz' | sha256sum -c - \
    && tar -xf whisper.tar.gz \
    && cmake -S whisper.cpp-23ee03506a91ac3d3f0071b40e66a430eebdfa1d -B whisper-build \
      -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
      -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_CUDA=OFF -DWHISPER_CURL=OFF -DWHISPER_FFMPEG=OFF \
    && cmake --build whisper-build --target whisper-cli -j4 \
    && cp whisper-build/bin/whisper-cli /opt/life-links/bin/whisper-cli \
    && cp whisper.cpp-23ee03506a91ac3d3f0071b40e66a430eebdfa1d/LICENSE /opt/life-links/licenses/whisper.cpp-MIT.txt \
    && cp whisper.tar.gz /opt/life-links/source/whisper.cpp-1.8.6.tar.gz \
    && mkdir -p /opt/life-links/models \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin \
      -o /opt/life-links/models/ggml-base.bin \
    && echo '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe  /opt/life-links/models/ggml-base.bin' | sha256sum -c -

FROM --platform=linux/amd64 node@sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac AS build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app
RUN node -e "if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Life Links canvas material requires linux/amd64')"
COPY . .
RUN node packages/canvas-linux-x64-gnu/native-build/verify-package.mjs packages/canvas-linux-x64-gnu
RUN pnpm install --frozen-lockfile && pnpm --filter @life-links/api build

FROM --platform=linux/amd64 node@sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac AS app
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    libreoffice-core=4:7.4.7-1+deb12u14 libreoffice-writer=4:7.4.7-1+deb12u14 libreoffice-calc=4:7.4.7-1+deb12u14 \
    libgomp1 fontconfig fonts-liberation fonts-dejavu-core fonts-crosextra-carlito \
    && dpkg-query -W > /opt/attachment-package-versions.txt && rm -rf /var/lib/apt/lists/*
COPY --from=native /opt/life-links /opt/life-links
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/life-links-demo/package.json apps/life-links-demo/package.json
COPY packages/canvas-linux-x64-gnu/package.json packages/canvas-linux-x64-gnu/package.json
COPY packages/life-links-core/package.json packages/life-links-core/package.json
COPY services/life-links-api/package.json services/life-links-api/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/life-links-demo/dist apps/life-links-demo/dist
COPY --from=build /app/packages/canvas-linux-x64-gnu packages/canvas-linux-x64-gnu
RUN node packages/canvas-linux-x64-gnu/native-build/verify-package.mjs packages/canvas-linux-x64-gnu
RUN node packages/canvas-linux-x64-gnu/native-build/smoke-wrapper.mjs smoke \
      --require-from services/life-links-api/package.json \
      --expected-native packages/canvas-linux-x64-gnu/skia.linux-x64-gnu.node
COPY --from=build /app/packages/life-links-core/dist packages/life-links-core/dist
COPY --from=build /app/services/life-links-api/dist services/life-links-api/dist
COPY services/life-links-api/migrations services/life-links-api/migrations
ENV NODE_ENV=production HOST=0.0.0.0 LANG=C.UTF-8
USER node
CMD ["node", "services/life-links-api/dist/main.js"]
