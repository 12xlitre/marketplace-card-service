import threading
import unittest

import server
from tests import test_content_workflow as fixtures
from tests import test_work_calendar as calendars


class DayPlanningTest(unittest.TestCase):
    setUp=fixtures.ContentWorkflowTest.setUp
    tearDown=fixtures.ContentWorkflowTest.tearDown
    plan=fixtures.ContentWorkflowTest.plan
    list=fixtures.ContentWorkflowTest.list
    batch=fixtures.ContentWorkflowTest.batch
    calendar=calendars.WorkCalendarTest.calendar
    legacy=calendars.WorkCalendarTest.legacy
    schedule=calendars.WorkCalendarTest.schedule

    def assign(self,task,day='2026-11-10',who='account',**extra):
        return server.workflow_calendar_assign_day(int(task['portalId']),{'taskId':task['id'],'day':day,**extra},self.users[who])

    def task(self,kind='semantic',portal=None):
        return next(t for t in self.calendar()['tasks'] if t['source']=='workflow' and t['id']==self.batch(kind,portal)['id'])

    def test_account_assigns_date_without_hours_and_tech_sees_pending_in_global_calendar(self):
        plan=self.plan();task=self.task()
        saved=self.assign(task)
        self.assertEqual(self.assign(task),saved)
        result=self.calendar();task=next(t for t in result['tasks'] if t['id']==task['id'])
        self.assertEqual(task['periodId'],plan['periodId'])
        self.assertEqual(task['planTitle'],'Ноябрь')
        slot=task['schedule'][0];self.assertIsNone(slot['minutes']);self.assertTrue(slot['plannedOnly'])
        day=next(d for d in result['days'] if d['day']=='2026-11-10')
        self.assertEqual(day['unestimated'],1);self.assertEqual(day['used'],0)
        self.assertEqual(sum(len(t['plannedDays']) for t in self.list()['batches']),1)
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_schedule').fetchone()[0],0)
        with self.assertRaisesRegex(ValueError,'schedule_required'):
            server.workflow_review_card(self.portal,{'batchId':task['id'],'cardKey':'1001'},self.users['tech'])

    def test_only_project_account_or_admin_can_assign_dates(self):
        self.plan();task=self.task()
        for login in ('other','lead','tech'):
            with self.assertRaises(PermissionError):self.assign(task,who=login)
        self.assign(task,who='admin')
        with self.assertRaises(PermissionError):
            server.workflow_calendar_unassign_day(self.portal,{'taskId':task['id'],'assignmentId':next(t for t in self.calendar()['tasks'] if t['id']==task['id'])['schedule'][0]['id']},self.users['lead'])

    def test_day_move_removes_only_target_assignment_and_validates_workdays_period(self):
        self.plan();task=self.task();a=self.assign(task);self.assign(task,day='2026-11-11')
        self.assign(task,day='2026-11-12',assignmentId=a['assignmentId'])
        slots=next(t for t in self.calendar()['tasks'] if t['id']==task['id'])['schedule']
        self.assertEqual({s['day'] for s in slots},{'2026-11-11','2026-11-12'})
        with self.assertRaisesRegex(ValueError,'nonworking_day'):self.assign(task,day='2026-11-14')
        with self.assertRaisesRegex(ValueError,'outside_period'):self.assign(task,day='2026-12-01')
        with self.assertRaisesRegex(ValueError,'version_conflict'):self.assign(task,assignmentId='unknown')

    def test_full_day_suggests_dates_without_inventing_estimated_minutes(self):
        self.plan();self.plan(self.ozon);task=self.task();other=self.task(portal=self.ozon)
        self.schedule(other,day='2026-11-10',minutes=480,startTime='09:00')
        with self.assertRaisesRegex(ValueError,'day_overloaded') as exc:self.assign(task)
        self.assertTrue(exc.exception.details['suggestions'])
        self.assertNotIn('requested',exc.exception.details)
        self.assertEqual(next(d for d in self.calendar()['days'] if d['day']=='2026-11-10')['unestimated'],0)

    def test_failed_estimate_retains_assignment_successful_estimate_replaces_it(self):
        self.plan();task=self.task();blocking=self.task('content');self.assign(task)
        self.schedule(blocking,day='2026-11-10',minutes=120,startTime='10:00')
        with self.assertRaisesRegex(ValueError,'time_overlap'):self.schedule(task,day='2026-11-10',minutes=60,startTime='10:30')
        self.assertTrue(next(t for t in self.calendar()['tasks'] if t['id']==task['id'])['schedule'][0]['plannedOnly'])
        self.schedule(task,day='2026-11-10',minutes=60,startTime='12:00')
        slots=next(t for t in self.calendar()['tasks'] if t['id']==task['id'])['schedule']
        self.assertEqual(len(slots),1);self.assertEqual(slots[0]['minutes'],60);self.assertNotIn('plannedOnly',slots[0])

    def test_30_minute_gap_limits_window_and_rejects_longer_booking(self):
        self.plan();target=self.legacy();self.assign(target)
        self.schedule(self.task(),day='2026-11-10',minutes=60,startTime='09:00')
        self.schedule(self.task('content'),day='2026-11-10',minutes=60,startTime='10:30')
        window=server.workflow_calendar_window(self.portal,target['id'],'2026-11-10','10:00',self.users['tech'])
        self.assertEqual(window['maxMinutes'],30);self.assertEqual(window['endMinute'],630)
        with self.assertRaisesRegex(ValueError,'time_overlap'):self.schedule(target,day='2026-11-10',minutes=60,startTime='10:00',windowEnd=1080)
        self.schedule(target,day='2026-11-10',minutes=30,startTime='10:00',windowEnd=1080)
        slots=next(t for t in self.calendar()['tasks'] if t['id']==target['id'])['schedule']
        self.assertEqual(len(slots),1);self.assertEqual(slots[0]['minutes'],30)
        self.assertEqual(next(d for d in self.calendar()['days'] if d['day']=='2026-11-10')['unestimated'],0)

    def test_window_includes_global_busy_time_day_capacity_and_grid_boundary(self):
        self.plan();self.plan(self.other);task=self.task();block=self.task(portal=self.other)
        self.schedule(block,day='2026-11-10',minutes=450,startTime='09:00')
        window=server.workflow_calendar_window(self.portal,task['id'],'2026-11-10','16:30',self.users['account'])
        self.assertEqual(window['maxMinutes'],30)
        window=server.workflow_calendar_window(self.portal,task['id'],'2026-11-10','10:00',self.users['tech'])
        self.assertEqual(window['maxMinutes'],0)
        window=server.workflow_calendar_window(self.portal,task['id'],'2026-11-11','17:30',self.users['tech'])
        self.assertEqual(window['maxMinutes'],30)
        with self.assertRaisesRegex(ValueError,'window_too_short'):self.schedule(task,day='2026-11-11',minutes=60,startTime='17:30',windowEnd=1080)
        with self.assertRaises(PermissionError):server.workflow_calendar_window(self.portal,task['id'],'2026-11-10','09:00',self.users['other'])

    def test_version_revision_moves_pending_days_and_cancel_releases_them(self):
        plan=self.plan();task=self.task();self.assign(task)
        data={'periodId':plan['periodId'],'version':1,'title':'Новая версия','start':'2026-11-09','end':'2026-11-30','tasks':['semantic_core_collection','content'],'cardKeys':['1001'],'assignee':'tech','contact':fixtures.CONTACT}
        server.workflow_revise_plan(self.portal,data,self.users['account'])
        active=next(t for t in self.calendar()['tasks'] if t['workType']=='semantic')
        self.assertNotEqual(active['id'],task['id']);self.assertEqual(active['schedule'][0]['day'],'2026-11-10')
        with self.assertRaises(PermissionError):self.assign(task)
        server.workflow_start_batch(self.portal,{'batchId':active['id'],'action':'cancel'},self.users['tech'])
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_day_assignments').fetchone()[0],0)

    def test_legacy_bulk_start_preserves_assigned_day_without_fake_load(self):
        task=self.legacy();self.assign(task)
        created=server.workflow_create_standalone(self.portal,{'requestId':'bulk-with-day','legacyGroupKey':task['groupKey'],'cardKeys':['1001']},self.users['account'])
        calendar=self.calendar();active=next(t for t in calendar['tasks'] if t['id']==created['batchId'])
        self.assertTrue(active['schedule'][0]['plannedOnly']);self.assertEqual(active['schedule'][0]['day'],'2026-11-10')
        self.assertEqual(next(d for d in calendar['days'] if d['day']=='2026-11-10')['used'],0)

    def test_concurrent_assignment_and_estimate_cannot_leave_pending_day_behind(self):
        self.plan();task=self.task();barrier=threading.Barrier(2);failures=[]
        def assign():
            barrier.wait()
            try:self.assign(task)
            except ValueError as e:
                if str(e)!='workflow_day_already_estimated':failures.append(str(e))
        def estimate():
            barrier.wait()
            try:self.schedule(task,day='2026-11-10',minutes=60,startTime='09:00')
            except Exception as e:failures.append(str(e))
        threads=[threading.Thread(target=assign),threading.Thread(target=estimate)]
        for t in threads:t.start()
        for t in threads:t.join(20)
        self.assertEqual(failures,[])
        with server.connect_db() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM workflow_day_assignments').fetchone()[0],0)
