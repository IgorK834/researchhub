import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
import tempfile
import sys
import xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('canvas_suite',Path(__file__).with_name('canvas-suite.py'))
suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)

class CanvasSuiteTest(TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.reports=self.root/'backend/target/surefire-reports';self.reports.mkdir(parents=True)
    def proof(self):
        names={n for v in suite.CASES.values() for n in v};root=ET.Element('testsuite',tests=str(len(names)),failures='0',errors='0',skipped='0')
        for n in names:
            classname,method=n.split('.',1);ET.SubElement(root,'testcase',classname='dev.researchhub.'+classname,name=method)
        ET.ElementTree(root).write(self.reports/'TEST-synthetic.xml')
    def test_every_matrix_case_requires_non_skipped_actual_evidence(self):
        self.assertEqual(24,len(suite.CASES));self.assertEqual(24,suite.evidence(self.reports)['requiredSkippedOrMissing']);self.proof()
        self.assertEqual(0,suite.evidence(self.reports)['requiredSkippedOrMissing'])
        p=self.reports/'TEST-synthetic.xml';tree=ET.parse(p);ET.SubElement(tree.getroot().find('testcase'),'skipped');tree.write(p)
        self.assertGreater(suite.evidence(self.reports)['requiredSkippedOrMissing'],0)
    def test_stage_captures_exit_code_and_private_log(self):
        with patch.object(suite.subprocess,'run',return_value=SimpleNamespace(returncode=1)):
            value=suite.stage('failed',['python'],self.root,self.root,{'SAFE':'1'})
        self.assertEqual(1,value['exitCode']);self.assertEqual(0o600,(self.root/'failed.log').stat().st_mode&0o777)
    def test_one_entrypoint_runs_all_layers_then_gated_explicit_live(self):
        self.proof();commands=[('backend',['fake'],self.root),('offline',['fake'],self.root)]
        with patch.object(suite,'ROOT',self.root),patch.object(suite,'commands',return_value=commands),patch.object(suite,'stage',side_effect=lambda n,*a:{'stage':n,'exitCode':0}) as stage,patch.object(suite.stack,'worker_env',return_value={'GEMINI_API_KEY':'synthetic'}) as worker:
            self.assertEqual(0,suite.main(['--output',str(self.root/'out')]))
            worker.assert_not_called()
            self.assertEqual(0,suite.main(['--live','--output',str(self.root/'out')]))
            self.assertEqual('synthetic',stage.call_args.args[-1]['GEMINI_API_KEY'])
            self.assertTrue(all('GEMINI_API_KEY' not in call.args[-1] for call in stage.call_args_list if call.args[0]!='live'))
        self.assertEqual(13,len(suite.commands()));self.assertIn('sandbox-build',[v[0] for v in suite.commands()])
    def test_failure_and_missing_proof_cannot_be_published_as_pass(self):
        with patch.object(suite,'ROOT',self.root),patch.object(suite,'commands',return_value=[('backend',['fake'],self.root)]),patch.object(suite,'stage',return_value={'stage':'backend','exitCode':1}):
            self.assertEqual(1,suite.main(['--live','--output',str(self.root/'out')]))
        with patch.object(suite,'ROOT',self.root),patch.object(suite,'commands',return_value=[('offline',['fake'],self.root)]),patch.object(suite,'stage',return_value={'stage':'offline','exitCode':0}):
            self.assertEqual(1,suite.main(['--live','--output',str(self.root/'out')]))
