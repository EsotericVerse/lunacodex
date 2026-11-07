# Deno 2 MCP and Extension SQL Gateway. Context is the repository root.
FROM denoland/deno:2.5.6
WORKDIR /app
ENV DENO_DIR=/deno-dir
ENV PORT=8000
COPY app ./app
COPY zenstack ./zenstack
COPY supabase/functions/loc-kysely/drivers.ts ./supabase/functions/loc-kysely/drivers.ts
COPY services/loc-mcp-sql ./services/loc-mcp-sql
RUN deno cache --config services/loc-mcp-sql/deno.json services/loc-mcp-sql/main.ts \
 && chown -R deno:deno /app /deno-dir
USER deno
EXPOSE 8000
ENTRYPOINT ["deno"]
CMD ["run", "--allow-env", "--allow-net", "--config", "services/loc-mcp-sql/deno.json", "services/loc-mcp-sql/main.ts"]
