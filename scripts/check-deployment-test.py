import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('deployment_check', Path(__file__).with_name('check-deployment.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DeploymentValidation(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        (root/'data').mkdir(); (root/'backups').mkdir()
        self.model = {'services': {
            'kuraki': {'image':'kuraki:test','environment':{'KURAKI_PUBLIC_URL':'https://photos.test','KURAKI_SECURE_COOKIES':'1','KURAKI_TRUST_PROXY':'1','KURAKI_BACKUP_DIR':'/backups'},'volumes':[
                {'type':'bind','source':str(root/'data'),'target':'/data'},
                {'type':'bind','source':str(root/'backups'),'target':'/backups'}]},
            'caddy': {'ports':[{'target':443,'published':'443'}]}}}
    def test_private_config_with_provisioned_mounts(self):
        self.assertEqual(module.validate(self.model)[0], 'kuraki:test')
    def test_backup_setting_outside_mount_rejected(self):
        self.model['services']['kuraki']['environment']['KURAKI_BACKUP_DIR'] = '/tmp/backups'
        with self.assertRaises(ValueError): module.validate(self.model)
    def test_direct_exposure_rejected(self):
        self.model['services']['kuraki']['ports'] = [{'target':39170,'published':'39170'}]
        with self.assertRaises(ValueError): module.validate(self.model)
    def test_placeholder_origin_rejected(self):
        self.model['services']['kuraki']['environment']['KURAKI_PUBLIC_URL'] = 'https://photos.example.com'
        with self.assertRaises(ValueError): module.validate(self.model)
    def test_missing_mount_rejected(self):
        self.model['services']['kuraki']['volumes'][0]['source'] += '/missing'
        with self.assertRaises(ValueError): module.validate(self.model)
    def test_backup_inside_library_rejected(self):
        self.model['services']['kuraki']['volumes'][1]['source'] = self.model['services']['kuraki']['volumes'][0]['source']
        with self.assertRaises(ValueError): module.validate(self.model)

if __name__ == '__main__': unittest.main()
