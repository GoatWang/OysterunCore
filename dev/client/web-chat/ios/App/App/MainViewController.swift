import Capacitor
import AppPlugin
import UIKit

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AppPlugin())
        bridge?.registerPluginInstance(OysterunAppAttestPlugin())
        bridge?.registerPluginInstance(OysterunDashboardAuthPlugin())
    }
}
