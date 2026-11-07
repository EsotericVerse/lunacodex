# Vercel Container runtime: select framework=container in a separate
# loc-sql project linked to this repository root. The existing Next.js project
# keeps framework=nextjs, so it does not build or run this container.
# Reuses exactly the independent Kysely/ZenStack SQL handler used by the
# services/loc-sql Dockerfile; no vendor Edge Function is involved.
FROM denoland/deno:2.5.6
WORKDIR /app
ENV DENO_DIR=/deno-dir
ENV PORT=8000
COPY app ./app
COPY zenstack ./zenstack
COPY services/loc-sql ./services/loc-sql
RUN deno cache --config services/loc-sql/deno.json services/loc-sql/main.ts \
 && chown -R deno:deno /app /deno-dir
USER deno
EXPOSE 8000
ENTRYPOINT ["deno"]
CMD ["run","--allow-env","--allow-net","--config","services/loc-sql/deno.json","services/loc-sql/main.ts"]
