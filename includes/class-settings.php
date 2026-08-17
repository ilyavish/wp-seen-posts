<?php
/**
 * Minimal compatibility settings for themes that cannot be detected safely.
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Settings {
	/** @var array<string,string> */
	private const FIELDS = array(
		'feed' => 'Feed/container selector',
		'post' => 'Individual post selector',
	);

	public static function init(): void {
		add_action( 'admin_init', array( self::class, 'register' ) );
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	public static function register(): void {
		register_setting(
			'wp_seen_posts',
			OPTION,
			array(
				'type'              => 'array',
				'default'           => array(),
				'sanitize_callback' => array( self::class, 'sanitize' ),
			)
		);

		add_settings_section(
			'wp_seen_posts_selectors',
			__( 'Theme compatibility', 'wp-seen-posts' ),
			array( self::class, 'section' ),
			'wp_seen_posts'
		);

		foreach ( self::FIELDS as $key => $label ) {
			add_settings_field(
				'wp_seen_posts_' . $key,
				esc_html__( $label, 'wp-seen-posts' ),
				array( self::class, 'field' ),
				'wp_seen_posts',
				'wp_seen_posts_selectors',
				array( 'key' => $key )
			);
		}
	}

	public static function menu(): void {
		add_options_page(
			__( 'Seen Posts', 'wp-seen-posts' ),
			__( 'Seen Posts', 'wp-seen-posts' ),
			'manage_options',
			'wp-seen-posts',
			array( self::class, 'page' )
		);
	}

	/** @return array<string,string> */
	public static function get_selectors(): array {
		$value = get_option( OPTION, array() );
		return is_array( $value ) ? array_intersect_key( $value, self::FIELDS ) : array();
	}

	/** @param mixed $input @return array<string,string> */
	public static function sanitize( $input ): array {
		$output = array();
		if ( ! is_array( $input ) ) {
			return $output;
		}

		foreach ( self::FIELDS as $key => $label ) {
			if ( empty( $input[ $key ] ) ) {
				continue;
			}
			$value = trim( sanitize_text_field( wp_unslash( $input[ $key ] ) ) );
			if ( strlen( $value ) <= 250 && ! preg_match( '/[{}<>]/', $value ) ) {
				$output[ $key ] = $value;
			}
		}
		return $output;
	}

	public static function section(): void {
		echo '<p>' . esc_html__( 'P2, P2 Resurrected, Query Loop blocks, and conservative classic markup are detected automatically. Only set both selectors when automatic detection does not find your feed.', 'wp-seen-posts' ) . '</p>';
	}

	/** @param array{key:string} $args */
	public static function field( array $args ): void {
		$key   = $args['key'];
		$value = self::get_selectors()[ $key ] ?? '';
		printf(
			'<input class="regular-text code" type="text" name="%1$s[%2$s]" value="%3$s" autocomplete="off">',
			esc_attr( OPTION ),
			esc_attr( $key ),
			esc_attr( $value )
		);
	}

	public static function page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Seen Posts', 'wp-seen-posts' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'wp_seen_posts' );
				do_settings_sections( 'wp_seen_posts' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}

