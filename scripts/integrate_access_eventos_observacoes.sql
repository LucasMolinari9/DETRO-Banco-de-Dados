begin;
lock table public.evento_teste,public.evento_dados,public.evento_textos,public.qh_teste in share row exclusive mode;
create temporary table _eventos_novos on commit drop as
select c.evento_id as id,c.row_data_original->>'Empresa' as codempresa,
       coalesce(c.row_data_original->>'CodLinha',c.row_data_original->>'Linha') as codlinha,
       (c.row_data_original->>'DataReg')::timestamp::date as data_registro,
       c.row_data_original->>'NumProcesso' as numero_processo,
       c.row_data_original->>'TipoDeEventoEmpresa' as evento_empresa,
       (c.row_data_original->>'DataPublic')::timestamp::date as data_publicacao,
       c.row_data_original->>'TipoDeEventoLinha' as evento_linha,
       c.descricao_recuperada as descricao,c.observacao_recuperada as observacao
from divat_integracao.evento_importacao_conciliacao c
where c.evento_id in(21639,21640,21641);
do $$ begin
 if (select count(*) from _eventos_novos)<>3
 or exists(select 1 from _eventos_novos n where exists(select 1 from public.evento_teste e where e.id=n.id)
 or exists(select 1 from public.evento_dados e where e.id=n.id)
 or exists(select 1 from public.evento_textos e where e.id=n.id)) then
 raise exception 'New event collision or missing source'; end if;
 if exists(select 1 from _eventos_novos n where n.observacao is null or n.observacao ~ '^[0-9a-f]{24}$'
 or not exists(select 1 from public.tabela_vista_teste v where v.codlinha=n.codlinha and v.codempresa=n.codempresa)) then
 raise exception 'New event unresolved text or identity'; end if;
 if (select count(*) from public.qh_teste q join divat_integracao.qh_operacional_origem o on o.qh_id=q.id
 where q.id in(256,571) and nullif(btrim(q.observacao),'') is null
 and q.codlinha=o.codlinha and q.codempresa=o.codempresa and q.ultima_alteracao=o.ultima_alteracao
 and q.frota_operacional=(o.row_data_original->>'FrotaOperacional')::integer
 and q.reserva=(o.row_data_original->>'Reserva')::integer
 and q.hierarquia=o.row_data_original->>'Hierarquização')<>2 then
 raise exception 'QH identity or concurrent update mismatch'; end if;
end $$;
insert into public.evento_dados(id,codempresa,codlinha,data_registro,evento_linha,evento_empresa,data_publicacao)
select id,codempresa,codlinha,data_registro,evento_linha,evento_empresa,data_publicacao from _eventos_novos;
insert into public.evento_textos(id,numero_processo,descricao,observacao)
select id,numero_processo,descricao,observacao from _eventos_novos;
insert into public.evento_teste(id,codempresa,codlinha,data_registro,numero_processo,evento_empresa,data_publicacao,evento_linha,descricao,observacao,fonte_registro,conferido_documentalmente,data_publicacao_suspeita)
select id,codempresa,codlinha,data_registro,numero_processo,evento_empresa,data_publicacao,evento_linha,descricao,observacao,
'Access / Eventos',false,false from _eventos_novos;

update public.qh_teste q set observacao=o.observacao_origem,
 observacao_fonte='Access / Tabela Quadro de Horários',observacao_conferida_documentalmente=false
from divat_integracao.qh_operacional_origem o
where q.id=o.qh_id and q.id in(256,571) and nullif(btrim(q.observacao),'') is null and q.codlinha=o.codlinha;

update public.evento_teste set data_publicacao_suspeita=true,
 fonte_registro='Conciliação Access / cadastro',conferido_documentalmente=false where id=19953;


insert into divat_integracao.atualizacao_auditoria_20260929(tabela,chave,antes,depois,motivo,aplicado_em)
select 'evento_teste',id::text,null,to_jsonb(e),'Inclusao fiel do registro Access; conferencia documental pendente',now()
from public.evento_teste e where id in(21639,21640,21641);
update divat_integracao.atualizacao_auditoria_20260929 a
set depois=to_jsonb(q),aplicado_em=now() from public.qh_teste q where a.tabela='qh_teste' and a.chave=q.id::text;
update divat_integracao.atualizacao_auditoria_20260929 a
set depois=to_jsonb(e),aplicado_em=now() from public.evento_teste e where a.tabela='evento_teste' and a.chave=e.id::text;

do $$ begin
 if (select count(*) from public.evento_teste)<>20901
 or (select count(*) from public.evento_dados)<>20901
 or (select count(*) from public.evento_textos)<>20901 then raise exception 'Event projection counts do not match source';end if;
 if exists(select 1 from _eventos_novos n join public.evento_teste e using(id)
 join public.evento_dados d using(id) join public.evento_textos t using(id)
 where to_jsonb(n) <> (to_jsonb(e)-'fonte_registro'-'conferido_documentalmente'-'data_publicacao_suspeita')
 or t.descricao is distinct from e.descricao or t.observacao is distinct from e.observacao
 or d.codlinha is distinct from e.codlinha) then raise exception 'Event projection contents diverge';end if;
 if (select count(*) from public.qh_teste where id in(256,571) and observacao_fonte is not null and observacao is not null)<>2
 then raise exception 'QH observations missing';end if;
end $$;
commit;
select jsonb_build_object('eventos',(select count(*) from public.evento_teste),
'eventos_novos',(select count(*) from public.evento_teste where id in(21639,21640,21641)),
'observacoes_qh',(select count(*) from public.qh_teste where nullif(btrim(observacao),'') is not null),
'data_conflitante_sinalizada',(select data_publicacao_suspeita from public.evento_teste where id=19953)) as resultado;
