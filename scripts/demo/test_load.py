import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("load_report", Path(__file__).with_name("run-load.py"))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

class EvidenceTests(unittest.TestCase):
    def test_percentiles_and_units_are_explicit(self):
        self.assertIsNone(report.percentile([], .95))
        self.assertEqual(report.percentile([10, 0], .5), 5)
        self.assertEqual(report.percentile([10], .99), 10)
        self.assertEqual(report.memory_bytes("1.5MiB"), 1572864)
        self.assertEqual(report.memory_bytes("1.5MB"), 1500000)
        self.assertEqual(report.memory_bytes("5B"), 5)
        with self.assertRaises(ValueError): report.memory_bytes("unknown")
        self.assertEqual(report.gauge('hikaricp_connections_pending{pool="main"} 2.0\n', 'hikaricp_connections_pending'), 2)
        self.assertIsNone(report.gauge('other 5\n', 'hikaricp_connections_active'))
    def test_report_excludes_setup_and_keeps_errors_authentication_and_replica_distribution(self):
        points = [{"type":"Metric","metric":"http_req_duration"}]
        def point(metric,value,tags): return {"type":"Point","metric":metric,"data":{"value":value,"tags":tags}}
        points += [point('http_req_duration',100,{'phase':'setup','endpoint':'login','status':'200'}),
                   point('http_req_duration',10,{'phase':'run','endpoint':'workspace-list','status':'200'}),
                   point('http_req_duration',30,{'phase':'run','endpoint':'workspace-list','status':'401'}),
                   point('replica_requests',1,{'replica':'backend-1'}), point('replica_requests',1,{'replica':'backend-2'}),
                   point('authentication_failures',1,{}), point('unrelated',0,{})]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'raw.json'
            path.write_text(''.join(json.dumps(point)+'\n' for point in points))
            value=report.aggregate(path)
            self.assertEqual(value['requests'],2)
            self.assertEqual(value['latencyMs']['p50'],20)
            self.assertEqual(value['errorRate'],.5)
            self.assertEqual(value['authenticationFailures'],1)
            self.assertEqual(value['replicaDistribution'],{'backend-1':1,'backend-2':1})
            path.write_text('')
            self.assertEqual(report.aggregate(path)['errorRate'],1)
    def test_collector_records_pool_pressure_and_surfaces_sampling_failures(self):
        stop=Mock()
        stop.is_set.side_effect=[False,True]
        rows,failures=[],[]
        stats=json.dumps({'Name':'researchhub-scale-backend-1-1','CPUPerc':'120.5%','MemUsage':'128MiB / 1GiB'})+'\n'
        with patch.object(report.subprocess,'check_output',side_effect=['container',stats,'5\n']), \
             patch.object(report.urllib.request,'urlopen',return_value=io.BytesIO(b'hikaricp_connections_active{pool="main"} 3.0\nhikaricp_connections_pending{pool="main"} 1.0\n')):
            report.collect(stop,rows,'smoke','generated-test-token',failures)
        self.assertEqual(rows[0]['pool_active'],3)
        self.assertEqual(rows[0]['pool_pending'],1)
        self.assertEqual(rows[0]['db_connections'],5)
        self.assertEqual(rows[0]['cpu_percent'],120.5)
        self.assertEqual(failures,[])
        stop.is_set.side_effect=[False,True]
        with patch.object(report.subprocess,'check_output',side_effect=['container',OSError('unavailable')]):
            report.collect(stop,rows,'smoke','generated-test-token',failures)
        self.assertEqual(failures,['OSError'])
    def test_script_hash_binds_paths_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(report,'ROOT',Path(directory)):
            root=Path(directory)/'performance/k6/lib'
            root.mkdir(parents=True)
            (root/'scenario.js').write_text('synthetic')
            first=report.script_hash()
            self.assertEqual(first,report.script_hash())
            (root/'scenario.js').write_text('changed')
            self.assertNotEqual(first,report.script_hash())

if __name__ == '__main__':
    unittest.main()
