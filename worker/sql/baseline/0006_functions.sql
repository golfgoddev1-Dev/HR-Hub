-- Baseline schema (public), generated from pg_catalog. Apply to an EMPTY database only.
-- Production already has these objects; do not run against it.

-- 8. Functions (before policies, which may call them)
CREATE OR REPLACE FUNCTION public.increment_national_id_view(p_viewer uuid, p_day date)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.national_id_view_log (viewer_id, view_date, view_count, updated_at)
  values (p_viewer, p_day, 1, now())
  on conflict (viewer_id, view_date)
  do update set view_count = public.national_id_view_log.view_count + 1,
                updated_at = now()
  returning view_count;
$function$
;
