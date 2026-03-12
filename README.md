# ClickUp Dashboard

Dashboard legado separado usado pelo gerenciador e tambem acessivel diretamente.

## Portas

- Backend: `3001`
- Frontend: `5173`

## Setup

### Backend

```powershell
cd backend
Copy-Item .env.example .env
# preencha CLICKUP_API_KEY
npm install
npm run start
```

### Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run preview -- --host 0.0.0.0 --port 5173
```

## Integracao com o gerenciador

Quando o repositorio `dashboard_manager` estiver ao lado deste repositorio, os scripts dele conseguem subir esta stack inteira automaticamente.

Estrutura esperada:

```text
workspace/
  dashboard_manager/
  clickup_dashboard/
```

## Observacoes

- O backend cria automaticamente a pasta/arquivo de historico em `backend/data/dashboard_history.json` quando necessario.
- Esse arquivo e dado de runtime local e nao faz parte do codigo versionado.
- O frontend aceita `VITE_API_BASE_URL` vazio para usar o host atual automaticamente.
