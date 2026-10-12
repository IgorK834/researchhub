"""Fresh verification container: reads only frozen JSON, never generated Python."""
import sys
sys.path.insert(0, '/opt/researchhub')
from problem import main
if __name__=='__main__': sys.exit(main(verify=True))
