alter table public.work_tasks
  drop constraint if exists work_tasks_related_type_check,
  add constraint work_tasks_related_type_check
    check (related_type in ('lead', 'company', 'order', 'booking', 'relationship', 'project', 'deliverable', 'renewal', 'payment'));
