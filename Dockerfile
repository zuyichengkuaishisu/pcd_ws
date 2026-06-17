FROM node:24-bookworm-slim

WORKDIR /app/web-pcd-viewer

COPY web-pcd-viewer/package.json web-pcd-viewer/package-lock.json ./
RUN npm ci

COPY web-pcd-viewer ./
COPY data /app/data
COPY m20_robot_monitoring_protocol.md /app/m20_robot_monitoring_protocol.md
COPY m20_mapping_udp_protocol.md /app/m20_mapping_udp_protocol.md

RUN npm run build

ENV NODE_ENV=production
ENV M20_MAPS_DIR=/app/data/maps
ENV M20_PCD_SAMPLE_DIR=/app/data/pcd_samples
ENV M20_DEFAULT_MAP_ASSET_NAME=siteB-20260616-105415

EXPOSE 4174

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4174"]
