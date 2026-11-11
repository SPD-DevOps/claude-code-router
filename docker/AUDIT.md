# Exportação de auditoria do CCR compartilhado

Opt-in: `CCR_AUDIT_ENABLED=1`, `CCR_AUDIT_INSTANCE_ID=shared-v1`,
`CCR_AUDIT_SINCE` ISO 8601, `CCR_AUDIT_EXCLUDE_PRINCIPAL` SHA256 do ID da chave exclusiva
do auditor. Sem estes campos o exportador falha fechado, sem produzir entrada auditável.
Não habilitar na instância pessoal. `CCR_LOG_S3_PREFIX=shared-v1` separa snapshots novos.

Após autenticação, o servidor substitui qualquer `x-ccr-audit-principal` fornecido pelo cliente
por SHA256 do ID interno da chave (não do token). Auth estático/bypass sem identidade fica
sem principal. Header `x-ccr-*` é removido pelo sanitizador antes do upstream; os headers auth
originais continuam mascarados. Identidade é da chave, não prova de autoria individual.
Resolver um principal ao responsável exige comparar SHA256 dos IDs internos sob acesso admin.
Não exportar chaves, credenciais ou config.sqlite. Histórico mascarado não é reconstruído.

O processo de exportação usa backup online SQLite, lê corpos externos apenas por referências
validadas dentro de request-log-bodies e exporta **somente a última mensagem de usuário com
texto**, ignorando resultados de ferramentas, system prompts e respostas do modelo.
Não é revisão integral da conversa nem análise de arquivos/imagens. Redação de segredos/e-mails
é best-effort, não anonimização garantida. Campos pessoais não detectados podem permanecer.

S3: `audit/<instance>/normalized/YYYY-MM-DD.jsonl`, data civil America/Sao_Paulo, e
`audit/<instance>/coverage/YYYY-MM-DD.json`. A entrada diária é mesclada por request_id com
exportações anteriores para não apagar histórico após retenção/reinício. Sem escritores
concorrentes para a mesma instância/prefixo. Cada manifesto tem SHA256 e cobertura do snapshot
mais recente (não cobertura global do histórico), além de total acumulado exportado.
Limites: 8 MiB/corpo, 24000 caracteres/texto, 10 MB/partição; exclusões de conteúdo contam no
manifesto, não são apresentadas como auditadas. Upload JSONL e manifesto não é transação: o
consumidor deve conferir SHA256 e recusar manifesto divergente. S3/ACL devem ser privados.

A chave dedicada do próprio auditor é excluída por identidade autenticada para evitar recursão;
User-Agent e conteúdo não são usados como critério de exclusão (cliente pode falsificá-los).
