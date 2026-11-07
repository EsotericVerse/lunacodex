# Independent LOC SQL Gateway; context is repository root, not Supabase Edge.
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
