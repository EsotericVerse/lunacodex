FROM node:22-bookworm-slim
WORKDIR /loc
COPY container/loc-compute/package.json container/loc-compute/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY app/loc/compute/contract.mjs app/loc/compute/operations.mjs app/loc/compute/
COPY app/loc/keywords/item-count-analysis.mjs app/loc/keywords/content-filter.mjs app/loc/keywords/literal-matcher.mjs app/loc/keywords/
COPY app/loc/model/keyword-engine.mjs app/loc/model/rune-keyword-rules.mjs app/loc/model/
COPY app/loc/import/duplicate-check.mjs app/loc/import/geocoordinates.mjs app/loc/import/unique-createtime.mjs app/loc/import/
COPY app/loc/query/query-batch-size.mjs app/loc/query/
COPY modules/loc/dialect/sql-workload-policy.mjs modules/loc/dialect/
COPY container/loc-compute/server.mjs container/loc-compute/
USER node
EXPOSE 8080
CMD ["node","container/loc-compute/server.mjs"]
