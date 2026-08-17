<?php
/** Remove only this plugin's WordPress option. Browser-local history remains user-controlled. */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'wp_seen_posts_selectors' );

