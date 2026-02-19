# ClickUp Dashboard (Local)

Dashboard operacional em React + Node para monitorar fluxo de tarefas no ClickUp.

## O que entrega

- Saude do fluxo: WIP, backlog, concluidas hoje/semana, atrasadas.
- Gargalos: aging por status, lead time, cycle time, top 10 tasks paradas.
- Capacidade: carga por responsavel, fila por prioridade.
- Qualidade/SLA: SLA cumprido vs estourado, categorias, primeira resposta (quando houver campo).

## Backend

```bash
cd backend
npm install
cp .env.example .env
# preencha CLICKUP_API_KEY
npm run start
```

Backend padrao: `http://localhost:3001`

## Frontend

```bash
cd frontend
npm install
cp .env.example .env
# opcional: ajuste VITE_API_BASE_URL para seu backend
npm run dev
```

Frontend padrao: `http://localhost:5173`

## Atualizacao

- O frontend permite polling de `1s`, `2s` ou `3s`.
- O backend usa cache em memoria (`CACHE_TTL_MS`) para reduzir chamadas ao ClickUp.

## Observacoes

- O KPI de retrabalho e um proxy quando nao ha historico detalhado de transicoes.
- Aging usa `date_status_changed`/`date_updated`/`date_created` conforme disponibilidade.
